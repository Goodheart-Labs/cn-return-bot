/**
 * Dashboard export #6 — the posts we found (read-only).
 *
 * One row per sighted topic post: link, when we saw it, how big it was
 * (BUCKETED — per the current ToS posture the dashboard ships ranges, not
 * per-tweet counts; raw numbers stay on this side of the boundary), and its
 * disposition through the pipeline. This is the browsable "all the tweets we
 * found and what we did about each" view that makes the funnel concrete.
 *
 * Dispositions (machine keys; the app maps them to client-friendly labels
 * and must never render the raw key):
 *   submitted               — a note went to X (note_id present)
 *   written_not_submitted   — a note was produced but not submitted (+reason)
 *   processed_no_note       — pipeline ran, no note produced (+reason)
 *   selected_not_processed  — judged worth a note, never reached the pipeline
 *   judged_no_note_needed   — reviewed, no correctable claim
 *   sighted                 — matched the topic, not yet judged
 *
 * Coverage: ALL posts that were selected or processed, plus the top
 * `TOP_UNSELECTED` never-selected posts by size; `not_shown_count` makes the
 * truncation visible.
 *
 *   bun run src/scripts_rob/dashboard_exports/export_posts.ts [--out <file>]
 */

import { SupabaseLogger } from "../../api/supabaseClient";

const TOPIC_ID = "trump_election_security";
const TOP_UNSELECTED = 250;
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx !== -1 ? process.argv[outIdx + 1]! : `${import.meta.dir}/out/posts.json`;

const logger = new SupabaseLogger();
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

const impressionBucket = (n: number | null): string | null =>
  n == null ? null : n < 10_000 ? "<10k" : n < 100_000 ? "10k–100k" : n < 1_000_000 ? "100k–1M" : ">1M";
const velocityBucket = (perHour: number | null): string | null =>
  perHour == null ? null
  : perHour < 1_000 ? "<1k/h" : perHour < 10_000 ? "1k–10k/h" : perHour < 50_000 ? "10k–50k/h" : ">50k/h";

// ── Sightings (unique per tweet) ─────────────────────────────────────────────
const sightings = await logger.fetchAllRows<{
  id: number; tweet_id: string; first_seen_at: string; impression_count: number | null;
  needs_note: boolean | null; processed_run_id: string | null;
}>(
  (c) => c.from("misinfo_monitoring_sightings")
    .select("id, tweet_id, first_seen_at, impression_count, needs_note, processed_run_id")
    .eq("topic_id", TOPIC_ID),
  "id", "sightings");

// ── Runs for processed posts ─────────────────────────────────────────────────
interface Run { id: string; outcome: string | null; outcome_reason: string | null; note_text: string | null; note_id: string | null }
const runById = new Map<string, Run>();
for (const ids of chunk(sightings.map((s) => s.processed_run_id).filter((x): x is string => !!x), 100)) {
  for (const r of await logger.fetchAllRows<Run>(
    (c) => c.from("pipeline_runs").select("id, outcome, outcome_reason, note_text, note_id").in("id", ids),
    "id")) {
    runById.set(r.id, r);
  }
}

// ── posted_at for velocity (only pipeline-processed posts are in `tweets`) ───
const postedAt = new Map<string, string | null>();
for (const ids of chunk([...new Set(sightings.map((s) => s.tweet_id))], 100)) {
  for (const t of await logger.fetchAllRows<{ tweet_id: string; posted_at: string | null }>(
    (c) => c.from("tweets").select("tweet_id, posted_at").in("tweet_id", ids), "tweet_id")) {
    postedAt.set(t.tweet_id, t.posted_at);
  }
}

// ── Disposition per sighting ─────────────────────────────────────────────────
function disposition(s: (typeof sightings)[number]): { disposition: string; reason: string | null; note_id: string | null } {
  const run = s.processed_run_id ? runById.get(s.processed_run_id) : undefined;
  if (run) {
    if (run.note_id) return { disposition: "submitted", reason: null, note_id: run.note_id };
    if ((run.note_text ?? "").trim())
      return { disposition: "written_not_submitted", reason: run.outcome_reason ?? run.outcome, note_id: null };
    return { disposition: "processed_no_note", reason: run.outcome_reason ?? run.outcome, note_id: null };
  }
  if (s.needs_note === true) return { disposition: "selected_not_processed", reason: null, note_id: null };
  if (s.needs_note === false) return { disposition: "judged_no_note_needed", reason: null, note_id: null };
  return { disposition: "sighted", reason: null, note_id: null };
}

const rows = sightings.map((s) => {
  const d = disposition(s);
  const posted = postedAt.get(s.tweet_id) ?? null;
  const hours = posted && s.first_seen_at ? (Date.parse(s.first_seen_at) - Date.parse(posted)) / 3.6e6 : null;
  const perHour = s.impression_count != null && hours != null && hours > 0 ? s.impression_count / hours : null;
  return {
    tweet_url: `https://x.com/i/status/${s.tweet_id}`,
    first_seen_at: s.first_seen_at,
    impressions_bucket: impressionBucket(s.impression_count),
    velocity_bucket: velocityBucket(perHour),
    ...d,
    note_url: d.note_id ? `https://x.com/i/birdwatch/n/${d.note_id}` : null,
    _impressions: s.impression_count ?? 0, // sort key, stripped below
  };
});

const important = rows.filter((r) => r.disposition !== "sighted" && r.disposition !== "judged_no_note_needed");
const rest = rows
  .filter((r) => r.disposition === "sighted" || r.disposition === "judged_no_note_needed")
  .sort((a, b) => b._impressions - a._impressions);
const kept = [...important, ...rest.slice(0, TOP_UNSELECTED)]
  .sort((a, b) => b._impressions - a._impressions)
  .map(({ _impressions, note_id, ...r }) => r);

const byDisposition = new Map<string, number>();
for (const r of rows) byDisposition.set(r.disposition, (byDisposition.get(r.disposition) ?? 0) + 1);

const out = {
  generated_at: new Date().toISOString(),
  topic: "Curated topic — the July 16, 2026 primetime address",
  field_notes: {
    coverage: "every post that was selected or processed, plus the largest never-selected posts; not_shown_count is the remainder",
    impressions_bucket: "impressions at first sighting, bucketed; a point-in-time undercount",
    velocity_bucket: "impressions per hour at first sighting; null when the post's creation time isn't held",
    disposition: "machine keys — the app renders friendly labels, never these strings",
  },
  totals_by_disposition: Object.fromEntries([...byDisposition.entries()].sort((a, b) => b[1] - a[1])),
  not_shown_count: rest.length - Math.min(rest.length, TOP_UNSELECTED),
  posts: kept,
};
await Bun.write(OUT, JSON.stringify(out, null, 2));

console.log(`\nposts → ${OUT}`);
console.log(`${kept.length} rows shown, ${out.not_shown_count} truncated`);
console.log(JSON.stringify(out.totals_by_disposition, null, 2));
