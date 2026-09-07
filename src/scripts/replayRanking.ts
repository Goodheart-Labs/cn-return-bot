/**
 * Replay a ranking scorer over labelled notes.
 *
 *   bun run replay-ranking --from 2026-08-10 --to 2026-08-31 [--scorer flags_then_eval] [--top 35] [--bar 30]
 *
 * --top N   keep the best N notes per day and report what that would have posted
 * --bar S   keep notes with submit score >= S
 */
import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { featuresFromTweetRow, flagCount, type RankFeatures, type TweetRow } from "../pipeline/ranking/features";
import { FLAG_CUTS_2026_08, SCORERS, getScorer } from "../pipeline/ranking/scorers";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const from = arg("from");
const to = arg("to");
if (!from || !to) {
  console.error("usage: --from YYYY-MM-DD --to YYYY-MM-DD [--scorer name] [--top N] [--bar S]");
  process.exit(1);
}
const scorerName = arg("scorer", "flags_then_eval")!;
const top = arg("top") ? Number(arg("top")) : null;
const bar = arg("bar") ? Number(arg("bar")) : null;

const client = getSupabaseClient();

async function pageAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build().range(offset, offset + 999);
    if (error) throw error;
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 80) out.push(...(await fetch(ids.slice(i, i + 80))));
  return out;
}

type NoteRow = { note_id: string; tweet_id: string; submitted_at: string; cn_status: string | null };
const notes = await pageAll<NoteRow>(() =>
  client.from("notes").select("note_id,tweet_id,submitted_at,cn_status").gte("submitted_at", `${from}T00:00:00Z`).lt("submitted_at", `${to}T00:00:00Z`).order("submitted_at"),
);

const tweets = new Map<string, TweetRow>();
for (const t of await inChunks(notes.map((n) => n.tweet_id), async (chunk) => {
  const { data, error } = await client.from("tweets").select("tweet_id,posted_at,first_seen_at,impressions,author_followers,has_video,has_photo").in("tweet_id", chunk);
  if (error) throw error;
  return data as (TweetRow & { tweet_id: string })[];
})) tweets.set(t.tweet_id, t);

const runs = await pageAll<{ id: string; note_id: string }>(() =>
  client.from("pipeline_runs").select("id,note_id").eq("outcome", "submitted").gte("created_at", `${from}T00:00:00Z`).lt("created_at", `${to}T00:00:00Z`).order("created_at"),
);
const runByNote = new Map(runs.map((r) => [r.note_id, r.id]));
const evalByRun = new Map<string, number>();
for (const s of await inChunks([...runByNote.values()], async (chunk) => {
  const { data, error } = await client.from("pipeline_scores").select("pipeline_run_id,score_value").eq("score_type", "evaluation").in("pipeline_run_id", chunk);
  if (error) throw error;
  return data as { pipeline_run_id: string; score_value: number | null }[];
})) if (s.score_value !== null) evalByRun.set(s.pipeline_run_id, Number(s.score_value));

interface Row { day: string; features: RankFeatures; flags: number; evalScore: number | null; submit: number; helpful: boolean; notHelpful: boolean }
const scorer = getScorer(scorerName);
const rows: Row[] = [];
for (const n of notes) {
  const t = tweets.get(n.tweet_id);
  if (!t) continue;
  const f = featuresFromTweetRow(t);
  const evalScore = evalByRun.get(runByNote.get(n.note_id) ?? "") ?? null;
  rows.push({
    day: n.submitted_at.slice(0, 10),
    features: f,
    flags: flagCount(f, FLAG_CUTS_2026_08),
    evalScore,
    submit: scorer.scoreSubmit(f, evalScore),
    helpful: n.cn_status === "CURRENTLY_RATED_HELPFUL",
    notHelpful: n.cn_status === "CURRENTLY_RATED_NOT_HELPFUL",
  });
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
const summarise = (label: string, sel: Row[]) => {
  const n = sel.length, H = sel.filter((r) => r.helpful).length, NH = sel.filter((r) => r.notHelpful).length;
  console.log(`${label.padEnd(34)} n=${String(n).padStart(4)}  H=${pct(H, n).padStart(6)}  NH=${pct(NH, n).padStart(6)}  net=${n ? ((100 * (H - NH)) / n).toFixed(1) : "—"}%`);
};

console.log(`\n${rows.length} labelled notes ${from}..${to}, scorer=${scorerName}\n`);
console.log("== by flag count");
for (const k of [4, 3, 2, 1, 0]) summarise(`${k}/4 flags`, rows.filter((r) => r.flags === k));

console.log("\n== top half kept, by ordering");
const days = new Set(rows.map((r) => r.day)).size;
const totalH = rows.filter((r) => r.helpful).length, totalNH = rows.filter((r) => r.notHelpful).length;
const half = Math.floor(rows.length / 2);
const keep = (key: (r: Row) => number) => {
  const s = [...rows].sort((a, b) => key(b) - key(a)).slice(0, half);
  return `H kept ${pct(s.filter((r) => r.helpful).length, totalH)}  NH kept ${pct(s.filter((r) => r.notHelpful).length, totalNH)}`;
};
console.log(`${"pipeline order (expected)".padEnd(34)} H kept 50.0%  NH kept 50.0%`);
console.log(`${"eval only".padEnd(34)} ${keep((r) => r.evalScore ?? -99)}`);
for (const s of Object.values(SCORERS)) console.log(`${s.name.padEnd(34)} ${keep((r) => s.scoreSubmit(r.features, r.evalScore))}`);

if (top !== null || bar !== null) {
  console.log(`\n== policy replay (${days} days)`);
  summarise("actual", rows);
  const byDay = new Map<string, Row[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  const kept: Row[] = [];
  for (const dayRows of byDay.values()) {
    const sorted = [...dayRows].sort((a, b) => b.submit - a.submit);
    kept.push(...(top !== null ? sorted.slice(0, top) : sorted.filter((r) => r.submit >= (bar as number))));
  }
  summarise(top !== null ? `top ${top}/day` : `bar >= ${bar}`, kept);
  console.log(`per day: ${(kept.length / days).toFixed(1)} notes, ${(kept.filter((r) => r.helpful).length / days).toFixed(1)} helpful, ${(kept.filter((r) => r.notHelpful).length / days).toFixed(1)} not helpful`);
}
