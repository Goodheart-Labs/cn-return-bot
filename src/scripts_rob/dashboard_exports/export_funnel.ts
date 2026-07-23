/**
 * Dashboard export #2 — the funnel (read-only).
 *
 * How topic posts moved through the pipeline: sighted → judged worth a note →
 * note written → note submitted → rated → displayed, plus what the LLM work
 * cost. Feeds the client dashboard's funnel section ("curated topic" framing —
 * no internal naming in the JSON) and the cost-per-outcome table.
 *
 * Units are mixed on purpose and labeled in series_notes: the top of the
 * funnel counts POSTS (sightings are unique per tweet), the middle counts
 * pipeline RUNS (a post can be processed more than once), the bottom counts
 * NOTES (unique note_id). Client-safe: links and aggregates only — no tweet
 * text, no model reasoning.
 *
 * Cost caveat: pipeline_runs.cost covers the note-production runs (search,
 * write, verify) in USD. It excludes the stage-1/stage-2 screening passes and
 * all non-LLM infrastructure, so cost-per-note figures are a floor.
 *
 *   bun run src/scripts_rob/dashboard_exports/export_funnel.ts [--out <file>]
 */

import { SupabaseLogger } from "../../api/supabaseClient";

const TOPIC_ID = "trump_election_security";
const SPEECH_DAY = "2026-07-16";
const HELPFUL = "CURRENTLY_RATED_HELPFUL";
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx !== -1 ? process.argv[outIdx + 1]! : `${import.meta.dir}/out/funnel.json`;

const logger = new SupabaseLogger();
const day = (iso: string | null | undefined) => (iso ?? "").slice(0, 10) || null;
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
const round = (v: number, places = 4) => Number(v.toFixed(places));

interface DayRow {
  date: string;
  /** Posts: unique tweets first sighted / judged worth a note that day. */
  posts_sighted: number;
  posts_selected: number;
  /** Runs: note-production attempts started that day; written = a note came out. */
  runs_processed: number;
  notes_written: number;
  /** Notes: unique notes submitted to X that day (by submitted_at). */
  notes_submitted: number;
  llm_cost_usd: number;
}
const rows = new Map<string, DayRow>();
const row = (d: string): DayRow => {
  const r = rows.get(d) ?? {
    date: d, posts_sighted: 0, posts_selected: 0, runs_processed: 0,
    notes_written: 0, notes_submitted: 0, llm_cost_usd: 0,
  };
  rows.set(d, r);
  return r;
};

// ── Sightings: the topic ledger (unique per tweet) ───────────────────────────
const sightings = await logger.fetchAllRows<{
  id: number; tweet_id: string; first_seen_at: string; needs_note: boolean | null;
  processed_run_id: string | null;
}>(
  (c) => c.from("misinfo_monitoring_sightings")
    .select("id, tweet_id, first_seen_at, needs_note, processed_run_id")
    .eq("topic_id", TOPIC_ID),
  "id", "sightings");
for (const s of sightings) {
  const d = day(s.first_seen_at);
  if (!d) continue;
  const r = row(d);
  r.posts_sighted++;
  if (s.needs_note === true) r.posts_selected++;
}

// ── Runs: every note-production attempt on a sighted post ────────────────────
interface Run {
  id: string; tweet_id: string; created_at: string; outcome: string | null;
  outcome_reason: string | null; note_text: string | null; note_id: string | null;
  cost: number | null;
}
const runIds = sightings.map((s) => s.processed_run_id).filter((x): x is string => !!x);
const runs: Run[] = [];
for (const ids of chunk(runIds, 100)) {
  runs.push(...await logger.fetchAllRows<Run>(
    (c) => c.from("pipeline_runs")
      .select("id, tweet_id, created_at, outcome, outcome_reason, note_text, note_id, cost")
      .in("id", ids),
    "id"));
}
const outcomeReasons = new Map<string, number>();
for (const rn of runs) {
  const d = day(rn.created_at);
  if (d) {
    const r = row(d);
    r.runs_processed++;
    if ((rn.note_text ?? "").trim()) r.notes_written++;
    r.llm_cost_usd += rn.cost ?? 0;
  }
  const key = `${rn.outcome ?? "unknown"}${rn.outcome_reason ? `/${rn.outcome_reason}` : ""}`;
  outcomeReasons.set(key, (outcomeReasons.get(key) ?? 0) + 1);
}

// ── Notes: what actually reached X, its ratings, its display status ──────────
const noteIds = [...new Set(runs.map((r) => r.note_id).filter((x): x is string => !!x))];
const notes: { note_id: string; submitted_at: string | null; cn_status: string | null }[] = [];
for (const ids of chunk(noteIds, 100)) {
  notes.push(...await logger.fetchAllRows<(typeof notes)[number]>(
    (c) => c.from("notes").select("note_id, submitted_at, cn_status").in("note_id", ids),
    "note_id"));
}
for (const n of notes) {
  const d = day(n.submitted_at);
  if (d) row(d).notes_submitted++;
}
const ratings: { note_id: string; helpful_count: number | null; somewhat_helpful_count: number | null; not_helpful_count: number | null }[] = [];
for (const ids of chunk(noteIds, 100)) {
  ratings.push(...await logger.fetchAllRows<(typeof ratings)[number]>(
    (c) => c.from("note_ratings_from_public_dump")
      .select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count")
      .in("note_id", ids),
    "note_id"));
}
const ratedNoteIds = new Set(
  ratings
    .filter((r) => (r.helpful_count ?? 0) + (r.somewhat_helpful_count ?? 0) + (r.not_helpful_count ?? 0) > 0)
    .map((r) => r.note_id),
);

// ── Totals & emit ────────────────────────────────────────────────────────────
const days = [...rows.values()].filter((r) => r.date >= SPEECH_DAY).sort((a, b) => a.date.localeCompare(b.date));
for (const r of days) r.llm_cost_usd = round(r.llm_cost_usd);

const notesWritten = runs.filter((r) => (r.note_text ?? "").trim()).length;
const totalCost = runs.reduce((sum, r) => sum + (r.cost ?? 0), 0);
const totals = {
  posts_sighted: sightings.length,
  posts_selected: sightings.filter((s) => s.needs_note === true).length,
  runs_processed: runs.length,
  notes_written: notesWritten,
  notes_submitted: notes.length,
  notes_rated: ratedNoteIds.size,
  notes_displayed: notes.filter((n) => n.cn_status === HELPFUL).length,
  llm_cost_usd: round(totalCost),
  cost_per_note_written_usd: notesWritten ? round(totalCost / notesWritten) : null,
  cost_per_note_submitted_usd: notes.length ? round(totalCost / notes.length) : null,
};

const out = {
  generated_at: new Date().toISOString(),
  topic: "Election-security address (2026-07-16) — curated topic",
  series_notes: {
    posts_sighted: "unique posts matching the topic that entered the ledger, by first-seen day",
    posts_selected: "of those, posts judged to carry a claim worth a context note",
    runs_processed: "note-production attempts (a post can be processed more than once)",
    notes_written: "attempts that produced a note (including notes cut by the daily writing cap)",
    notes_submitted: "unique notes submitted to X, by submission day",
    notes_rated: "submitted notes with at least one rating in X's public data (~48h lag)",
    notes_displayed: "submitted notes currently rated Helpful (displaying under the post)",
    llm_cost_usd: "LLM spend on note-production runs only; excludes screening passes and infrastructure — treat per-note costs as a floor",
  },
  totals,
  outcome_reasons: Object.fromEntries([...outcomeReasons.entries()].sort((a, b) => b[1] - a[1])),
  days,
};
await Bun.write(OUT, JSON.stringify(out, null, 2));

console.log(`\nfunnel → ${OUT}\n`);
console.log(`totals: ${JSON.stringify(totals, null, 2)}`);
console.log("\ndate         sighted  selected  processed  written  submitted   cost");
for (const r of days) {
  console.log(
    `${r.date}  ${String(r.posts_sighted).padStart(7)}  ${String(r.posts_selected).padStart(8)}  ${String(r.runs_processed).padStart(9)}  ${String(r.notes_written).padStart(7)}  ${String(r.notes_submitted).padStart(9)}  $${r.llm_cost_usd.toFixed(2)}`,
  );
}
