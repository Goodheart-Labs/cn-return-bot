/**
 * Build the labeled dataset of simple-bot runs for the Grok note-filter eval.
 *
 * Filters: bot=simple-bot, search=sonnet46-native, writer=gemini-flash,
 * created_at >= 2026-05-28, errors excluded. Labels each run wants_note /
 * no_note (see labeling.ts), then samples a balanced 100-row set (50 of each
 * class) deterministically (sorted by run id, which is a random UUID — so the
 * sample is reproducible across runs). Enriches with tweet text for inspection.
 *
 *   bun run src/scripts_jim/2026_06_05_grok_note_filter/buildDataset.ts
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { join } from "path";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows, fetchInBatches } from "../../api/paging";
import { labelRun, tweetUrl, type RunLabel } from "./labeling";

const SINCE = "2026-05-28T00:00:00Z";
const PER_CLASS = 50;

interface Run {
  id: string;
  tweet_id: string;
  ab_test_picks: Record<string, string> | null;
  outcome: string;
  outcome_reason: string | null;
  note_status: string | null;
  note_text: string | null;
  created_at: string;
}

export interface DatasetRow {
  runId: string;
  tweetId: string;
  tweetUrl: string;
  label: RunLabel; // "wants_note" | "no_note"
  outcome: string;
  outcomeReason: string | null;
  noteStatus: string | null;
  noteText: string | null;
  tweetText: string | null;
  hasVideo: boolean | null;
  hasPhoto: boolean | null;
  createdAt: string;
}

async function main() {
  const client = getSupabaseClient();

  const runs = await fetchAllRows<Run>(
    () =>
      client
        .from("pipeline_runs")
        .select(
          "id, tweet_id, ab_test_picks, outcome, outcome_reason, note_status, note_text, created_at",
        )
        .eq("bot_name", "simple-bot")
        .gte("created_at", SINCE),
    "id",
    { label: "buildDataset.simple_bot" },
  );

  const matches = runs.filter(
    (r) =>
      r.ab_test_picks?.["simple_bot_search"] === "sonnet46-native" &&
      r.ab_test_picks?.["simple_bot_writer"] === "gemini-flash",
  );

  const labeled = matches
    .map((r) => ({ run: r, label: labelRun(r.outcome, r.outcome_reason) }))
    .filter((x) => x.label !== "exclude");

  const wantsNote = labeled.filter((x) => x.label === "wants_note");
  const noNote = labeled.filter((x) => x.label === "no_note");
  console.log(`Eligible: ${labeled.length}  (wants_note=${wantsNote.length}, no_note=${noNote.length})`);

  // Deterministic balanced sample: sort by run id (random UUID) and take first N.
  const sortById = (a: { run: Run }, b: { run: Run }) => a.run.id.localeCompare(b.run.id);
  const pickedWants = [...wantsNote].sort(sortById).slice(0, PER_CLASS);
  const pickedNo = [...noNote].sort(sortById).slice(0, PER_CLASS);
  const picked = [...pickedWants, ...pickedNo];
  console.log(`Sampled: wants_note=${pickedWants.length}, no_note=${pickedNo.length}, total=${picked.length}`);

  // Enrich with tweet text/media flags.
  const tweetIds = picked.map((p) => p.run.tweet_id);
  const tweets = await fetchInBatches<{
    tweet_id: string;
    text: string | null;
    has_video: boolean | null;
    has_photo: boolean | null;
  }>(
    (chunk) =>
      client.from("tweets").select("tweet_id, text, has_video, has_photo").in("tweet_id", chunk),
    tweetIds,
    { label: "buildDataset.tweets" },
  );
  const tweetById = new Map(tweets.map((t) => [t.tweet_id, t]));

  const rows: DatasetRow[] = picked.map(({ run, label }) => {
    const t = tweetById.get(run.tweet_id);
    return {
      runId: run.id,
      tweetId: run.tweet_id,
      tweetUrl: tweetUrl(run.tweet_id),
      label: label as RunLabel,
      outcome: run.outcome,
      outcomeReason: run.outcome_reason,
      noteStatus: run.note_status,
      noteText: run.note_text,
      tweetText: t?.text ?? null,
      hasVideo: t?.has_video ?? null,
      hasPhoto: t?.has_photo ?? null,
      createdAt: run.created_at,
    };
  });

  const outPath = join(import.meta.dir, "dataset.json");
  writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`\nWrote ${rows.length} rows -> ${outPath}`);

  // Composition of the positive class by reason (useful for FN breakdown later).
  const byReason = new Map<string, number>();
  for (const p of pickedWants) {
    const key = p.run.outcome_reason ?? `(${p.run.outcome})`;
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  console.log("\nwants_note composition:");
  for (const [k, v] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(3)}  ${k}`);
  }
}

main().then(() => process.exit(0));
