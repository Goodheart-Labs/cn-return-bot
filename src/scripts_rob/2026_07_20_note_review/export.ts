/**
 * Note-review export: every pipeline run for the trump_election_security
 * topic, joined with its sighting, tweet, scores, and (when submitted) the
 * live `notes` row — the raw material for the note-quality review that gates
 * the cap-raise decision.
 *
 * Read-only. Writes a single JSON blob to --out (default: stdout).
 *
 *   bun run src/scripts_rob/2026_07_20_note_review/export.ts --out review.json
 */

import { SupabaseLogger } from "../../api/supabaseClient";

const TOPIC = "trump_election_security";
const logger = new SupabaseLogger();

const outFlag = process.argv.indexOf("--out");
const outPath = outFlag !== -1 ? process.argv[outFlag + 1] : null;

const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

// ── 1. Processed sightings for the topic ────────────────────────────────────
const sightings = await logger.fetchAllRows<{
  id: number; tweet_id: string; impression_count: number | null; author_name: string | null;
  first_seen_at: string; needs_note: boolean | null; selection_reason: string | null;
  processed_run_id: string | null; processed_at: string | null;
}>(
  (c) => c
    .from("misinfo_monitoring_sightings")
    .select("id, tweet_id, impression_count, author_name, first_seen_at, needs_note, selection_reason, processed_run_id, processed_at")
    .eq("topic_id", TOPIC)
    .not("processed_run_id", "is", null),
  "id",
  "processed sightings",
);
const runIds = sightings.map((s) => s.processed_run_id!) ;
const sightingByRun = new Map(sightings.map((s) => [s.processed_run_id!, s]));
console.error(`[export] ${sightings.length} processed sightings`);

// ── 2. Their pipeline runs ──────────────────────────────────────────────────
interface Run {
  id: string; tweet_id: string; created_at: string; outcome: string | null;
  outcome_reason: string | null; final_stage: string | null; note_text: string | null;
  source_url: string | null; note_status: string | null; check_reasoning: string | null;
  error_message: string | null; note_id: string | null; bot_name: string | null;
}
const runs: Run[] = [];
for (const ids of chunk(runIds, 100)) {
  runs.push(...await logger.fetchAllRows<Run>(
    (c) => c
      .from("pipeline_runs")
      .select("id, tweet_id, created_at, outcome, outcome_reason, final_stage, note_text, source_url, note_status, check_reasoning, error_message, note_id, bot_name")
      .in("id", ids),
    "id",
  ));
}
console.error(`[export] ${runs.length} pipeline runs`);

// ── 3. Scores per run ───────────────────────────────────────────────────────
interface Score { pipeline_run_id: string; score_type: string; score_value: number | null; score_label: string | null; score_metadata: any }
const scores: Score[] = [];
for (const ids of chunk(runIds, 100)) {
  scores.push(...await logger.fetchAllRows<Score & { id: number }>(
    (c) => c
      .from("pipeline_scores")
      .select("id, pipeline_run_id, score_type, score_value, score_label, score_metadata")
      .in("pipeline_run_id", ids),
    "id",
  ));
}
const scoresByRun = new Map<string, Score[]>();
for (const s of scores) {
  const list = scoresByRun.get(s.pipeline_run_id) ?? [];
  list.push(s);
  scoresByRun.set(s.pipeline_run_id, list);
}
console.error(`[export] ${scores.length} scores`);

// ── 4. Tweets ───────────────────────────────────────────────────────────────
const tweetIds = [...new Set(runs.map((r) => r.tweet_id))];
const tweets: any[] = [];
for (const ids of chunk(tweetIds, 100)) {
  tweets.push(...await logger.fetchAllRows<any>(
    (c) => c.from("tweets").select("*").in("tweet_id", ids),
    "tweet_id",
  ));
}
const tweetById = new Map(tweets.map((t) => [t.tweet_id, (({ raw_tweet, ...rest }) => rest)(t)]));
console.error(`[export] ${tweets.length} tweets`);

// ── 5. Live notes rows for submitted runs ───────────────────────────────────
const noteIds = runs.map((r) => r.note_id).filter((x): x is string => !!x);
const notes: any[] = [];
for (const ids of chunk(noteIds, 100)) {
  notes.push(...await logger.fetchAllRows<any>(
    (c) => c.from("notes").select("*").in("note_id", ids),
    "note_id",
  ));
}
const noteById = new Map(notes.map((n) => [n.note_id, n]));
console.error(`[export] ${notes.length} notes rows`);

// ── 6. Competing notes on the same tweets (did someone else's note win?) ────
const competing: any[] = [];
for (const ids of chunk(tweetIds, 100)) {
  competing.push(...await logger.fetchAllRows<any>(
    (c) => c
      .from("competing_notes")
      .select("tweet_id, note_id, our_note_id, classification, current_status, note_text, created_at_millis")
      .in("tweet_id", ids),
    "note_id",
  ));
}
console.error(`[export] ${competing.length} competing notes on our tweets`);

// ── Assemble ────────────────────────────────────────────────────────────────
const rows = runs.map((r) => ({
  run: r,
  sighting: sightingByRun.get(r.id) ?? null,
  tweet: tweetById.get(r.tweet_id) ?? null,
  scores: scoresByRun.get(r.id) ?? [],
  note: r.note_id ? (noteById.get(r.note_id) ?? null) : null,
  competing: competing.filter((c) => c.tweet_id === r.tweet_id),
}));

const byOutcome = new Map<string, number>();
for (const r of rows) {
  const key = `${r.run.outcome}${r.run.outcome_reason ? `/${r.run.outcome_reason}` : ""}`;
  byOutcome.set(key, (byOutcome.get(key) ?? 0) + 1);
}
console.error(`[export] outcomes: ${[...byOutcome.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`);
for (const r of rows.filter((x) => x.note)) {
  const n = r.note!;
  console.error(
    `[export] submitted ${n.note_id} status=${n.cn_status} views=${n.view_count ?? "-"} ` +
    `ratings h/sh/nh=${n.helpful_count}/${n.somewhat_helpful_count}/${n.not_helpful_count} submitted_at=${n.submitted_at}`,
  );
}

const payload = { exported_at: new Date().toISOString(), topic: TOPIC, rows };
const json = JSON.stringify(payload, null, 1);
if (outPath) {
  await Bun.write(outPath, json);
  console.error(`[export] wrote ${outPath} (${(json.length / 1e6).toFixed(1)} MB)`);
} else {
  console.log(json);
}
