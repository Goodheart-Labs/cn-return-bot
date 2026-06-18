/**
 * Find every tweet where cheap-bot submitted a note in prod that is now
 * CURRENTLY_RATED_NOT_HELPFUL. Joins:
 *   pipeline_runs (bot_name='cheap-bot', outcome='submitted')  → note_id, tweet_id, note_text
 *   notes (cn_status)                                          → the unhelpful filter
 *   review_dashboard_annotations (source='production')         → our internal failure_modes tags
 *   note_ratings_from_public_dump                              → X rater not_helpful_tag_counts
 *
 * Writes datasets-style CSV (url + failure_reason + original_note_text) for
 * tryoutNotes, and prints a per-note summary so we can eyeball the errors.
 */
import { writeFile } from "fs/promises";
import { join } from "path";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../api/paging";

const OUT_DIR = join("src/scripts_jim/2026_05_31_gemini_cheap_bot_unhelpful");

function normStatus(s?: string | null): string {
  return (s ?? "").toUpperCase().replace(/\s+/g, "_");
}

async function chunkedIn<T extends Record<string, any>>(
  table: string,
  col: string,
  values: string[],
  select: string,
  keyCol: string,
): Promise<T[]> {
  const client = getSupabaseClient();
  const out: T[] = [];
  const CHUNK = 150;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    const rows = await fetchAllRows<T>(
      () => client.from(table).select(select).in(col, slice),
      keyCol,
      `${table}.in`,
    );
    out.push(...rows);
  }
  return out;
}

interface RunRow { id: string; tweet_id: string; note_id: string; note_text?: string; ab_test_picks?: Record<string, string>; created_at: string }
interface NoteRow { note_id: string; tweet_id: string; cn_status?: string; not_helpful_count?: number; helpful_count?: number; rating_count?: number }
interface AnnRow { target_id: string; failure_modes?: string[]; comment?: string; seen?: boolean }
interface PublicRow { note_id: string; not_helpful_count?: number; not_helpful_tag_counts?: Record<string, number>; helpful_tag_counts?: Record<string, number> }

const client = getSupabaseClient();

// 1. cheap-bot submitted runs
const runs = await fetchAllRows<RunRow>(
  () => client.from("pipeline_runs")
    .select("id, tweet_id, note_id, note_text, ab_test_picks, created_at")
    .eq("bot_name", "cheap-bot")
    .eq("outcome", "submitted")
    .not("note_id", "is", null),
  "id",
  "pipeline_runs.cheapbot",
);
console.log(`cheap-bot submitted runs with note_id: ${runs.length}`);

const noteIds = [...new Set(runs.map((r) => r.note_id))];
if (noteIds.length === 0) { console.log("No cheap-bot notes found."); process.exit(0); }

// 2. their notes rows (status / rating counts)
const notes = await chunkedIn<NoteRow>(
  "notes", "note_id", noteIds,
  "note_id, tweet_id, cn_status, not_helpful_count, helpful_count, rating_count",
  "note_id",
);
const noteById = new Map(notes.map((n) => [n.note_id, n]));

const unhelpfulNoteIds = new Set(notes
  .filter((n) => normStatus(n.cn_status) === "CURRENTLY_RATED_NOT_HELPFUL")
  .map((n) => n.note_id));
console.log(`...of which CURRENTLY_RATED_NOT_HELPFUL: ${unhelpfulNoteIds.size}`);

// status distribution for context
const dist: Record<string, number> = {};
for (const n of notes) { const s = normStatus(n.cn_status) || "(null)"; dist[s] = (dist[s] ?? 0) + 1; }
console.log("status distribution:", dist);

// 3. internal failure-mode annotations (across ALL cheap-bot notes — the team's
//    curated "this note was bad" set) + 4. X rater tags.
const [anns, publics] = await Promise.all([
  chunkedIn<AnnRow>("review_dashboard_annotations", "target_id", noteIds,
    "target_id, failure_modes, comment, seen", "target_id"),
  chunkedIn<PublicRow>("note_ratings_from_public_dump", "note_id", noteIds,
    "note_id, not_helpful_count, not_helpful_tag_counts, helpful_tag_counts", "note_id"),
]);
const annById = new Map(anns.map((a) => [a.target_id, a]));
const pubById = new Map(publics.map((p) => [p.note_id, p]));

const taggedNoteIds = new Set(anns.filter((a) => (a.failure_modes?.length ?? 0) > 0).map((a) => a.target_id));
console.log(`cheap-bot notes with internal failure_modes tags: ${taggedNoteIds.size}`);

// Candidate set = rated NOT_HELPFUL in prod OR tagged as a failure by the team.
const candidateNoteIds = new Set([...unhelpfulNoteIds, ...taggedNoteIds]);
console.log(`combined candidate set (unhelpful OR tagged): ${candidateNoteIds.size}`);
if (candidateNoteIds.size === 0) { console.log("Nothing to test — exiting."); process.exit(0); }

// dedupe to one run per note_id (latest)
const latestRunByNote = new Map<string, RunRow>();
for (const r of runs) {
  if (!candidateNoteIds.has(r.note_id)) continue;
  const prev = latestRunByNote.get(r.note_id);
  if (!prev || r.created_at > prev.created_at) latestRunByNote.set(r.note_id, r);
}

function topTags(counts?: Record<string, number>): string {
  if (!counts) return "";
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => `${k}:${v}`).join(", ");
}

const records = [...latestRunByNote.values()].map((run) => {
  const note = noteById.get(run.note_id)!;
  const ann = annById.get(run.note_id);
  const pub = pubById.get(run.note_id);
  const failureModes = ann?.failure_modes ?? [];
  const raterTags = topTags(pub?.not_helpful_tag_counts);
  const failureReasonParts = [
    failureModes.length ? `our tags: ${failureModes.join("; ")}` : "",
    ann?.comment ? `reviewer note: ${ann.comment}` : "",
    raterTags ? `X rater not-helpful tags: ${raterTags}` : "",
  ].filter(Boolean);
  const selection = [
    unhelpfulNoteIds.has(run.note_id) ? "rated_unhelpful" : "",
    taggedNoteIds.has(run.note_id) ? "team_tagged" : "",
  ].filter(Boolean).join("+");
  return {
    tweet_id: run.tweet_id,
    note_id: run.note_id,
    url: `https://x.com/i/status/${run.tweet_id}`,
    selection,
    cn_status: note.cn_status,
    not_helpful_count: pub?.not_helpful_count ?? note.not_helpful_count ?? 0,
    helpful_count: note.helpful_count ?? 0,
    bot_variant: JSON.stringify(run.ab_test_picks ?? {}),
    failure_modes: failureModes,
    reviewer_comment: ann?.comment ?? "",
    rater_tags: raterTags,
    failure_reason: failureReasonParts.join(" | "),
    original_note_text: run.note_text ?? "",
  };
}).sort((a, b) => b.not_helpful_count - a.not_helpful_count);

console.log(`\n=== ${records.length} cheap-bot candidate notes ===`);
for (const r of records) {
  console.log(`\n• ${r.url}  (note ${r.note_id})  [${r.selection}]  status=${r.cn_status ?? "?"} NH=${r.not_helpful_count} H=${r.helpful_count}`);
  console.log(`  note: ${r.original_note_text.slice(0, 180).replace(/\n/g, " ")}`);
  if (r.failure_modes.length) console.log(`  our tags: ${r.failure_modes.join("; ")}`);
  if (r.reviewer_comment) console.log(`  reviewer: ${r.reviewer_comment.slice(0, 160)}`);
  if (r.rater_tags) console.log(`  X rater NH tags: ${r.rater_tags}`);
}

// CSV for tryoutNotes (url is required; failure_reason + original_note_text feed the judge)
function csvCell(s: string): string {
  return `"${String(s).replace(/"/g, '""')}"`;
}
const header = ["url", "failure_reason", "original_note_text", "note_id"].join(",");
const lines = records.map((r) =>
  [csvCell(r.url), csvCell(r.failure_reason), csvCell(r.original_note_text), csvCell(r.note_id)].join(","),
);
await writeFile(join(OUT_DIR, "tweets.csv"), [header, ...lines].join("\n"));
await writeFile(join(OUT_DIR, "records.json"), JSON.stringify(records, null, 2));
console.log(`\nWrote ${records.length} rows to tweets.csv + records.json`);
