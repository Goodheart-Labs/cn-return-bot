/**
 * Per-day, last 10 days: pipeline runs whose tweet HAD media, and of those how
 * many had media analysis FAIL (Gemini exhausted all retries on both keys).
 *
 * - "had media": logs.tweet.post.media or .referenced_tweet_data.media non-empty
 *   (post is logged before media analysis, so failed runs still count).
 * - "media failed": error_message contains "Media analysis failed" — covers both
 *   the swallowed warning (text tweets) and the fatal media-only case.
 *
 * Queries one UTC day at a time so the created_at index serves the range scan;
 * deep JSON extraction then only touches that day's ~hundreds of rows.
 */
import { getSupabaseClient } from "../../api/supabaseClient";

const supabase = getSupabaseClient();
const WINDOW_DAYS = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Row {
  created_at: string;
  error_message: string | null;
  media: unknown;
  qmedia: unknown;
}

const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

async function fetchDay(dayStartMs: number): Promise<Row[]> {
  const start = new Date(dayStartMs).toISOString();
  const end = new Date(dayStartMs + MS_PER_DAY).toISOString();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select(
      "created_at, error_message, media:logs->tweet->post->media, qmedia:logs->tweet->post->referenced_tweet_data->media",
    )
    .gte("created_at", start)
    .lt("created_at", end)
    .limit(5000);
  if (error) throw error;
  if ((data?.length ?? 0) >= 5000) throw new Error(`Day ${start} hit the 5000-row cap`);
  return (data ?? []) as Row[];
}

async function main() {
  const todayStart = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY;

  console.log("\nDay         | runs  | had media | media analysis failed | fail %");
  console.log("------------|-------|-----------|-----------------------|-------");
  let tTotal = 0, tMedia = 0, tFailed = 0;

  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const dayStartMs = todayStart - i * MS_PER_DAY;
    const rows = await fetchDay(dayStartMs);
    let hadMedia = 0, failed = 0;
    for (const r of rows) {
      const had = len(r.media) > 0 || len(r.qmedia) > 0;
      const mediaFailed = /Media analysis failed/i.test(r.error_message ?? "");
      if (had) hadMedia++;
      if (mediaFailed) failed++; // a media-analysis failure implies media was present
    }
    tTotal += rows.length; tMedia += hadMedia; tFailed += failed;
    const pct = hadMedia ? ((failed / hadMedia) * 100).toFixed(1) : "—";
    const d = new Date(dayStartMs).toISOString().slice(0, 10);
    console.log(
      `${d}  | ${String(rows.length).padStart(5)} | ${String(hadMedia).padStart(9)} | ${String(failed).padStart(21)} | ${pct.padStart(5)}`,
    );
  }

  const totPct = tMedia ? ((tFailed / tMedia) * 100).toFixed(1) : "—";
  console.log("------------|-------|-----------|-----------------------|-------");
  console.log(
    `TOTAL       | ${String(tTotal).padStart(5)} | ${String(tMedia).padStart(9)} | ${String(tFailed).padStart(21)} | ${totPct.padStart(5)}`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
