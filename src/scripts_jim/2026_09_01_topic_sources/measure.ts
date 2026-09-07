/**
 * GOO-94 premise check: how did the topic-based (misinfo-monitoring) notes
 * actually perform, compared with the regular pipeline over the same window?
 *
 * A topic run is a pipeline_runs row whose ab_test_picks records
 * misinfo_monitoring = "yes". The topic id sits in ab_test_picks.misinfo_topic.
 *
 * Run from the repo root: bun run src/scripts_jim/2026_09_01_topic_sources/measure.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const PAGE_SIZE = 1000;

interface RunRow {
  id: string;
  tweet_id: string;
  note_id: string | null;
  outcome: string;
  outcome_reason: string | null;
  created_at: string;
  cost: number | null;
  ab_test_picks: Record<string, string> | null;
}

interface NoteRow {
  note_id: string;
  cn_status: string | null;
  view_count: number | null;
  rating_count: number;
  helpful_count: number;
  not_helpful_count: number;
}

async function fetchAllPages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

const RUN_COLUMNS = "id, tweet_id, note_id, outcome, outcome_reason, created_at, cost, ab_test_picks";

async function fetchTopicRuns(): Promise<RunRow[]> {
  return fetchAllPages<RunRow>((from, to) =>
    supabase
      .from("pipeline_runs")
      .select(RUN_COLUMNS)
      .eq("ab_test_picks->>misinfo_monitoring", "yes")
      .order("created_at", { ascending: true })
      .range(from, to),
  );
}

/** Regular submitted runs in the same window, as the comparison baseline. Only
 *  submitted ones are fetched, because fetching every regular run would pull
 *  hundreds of thousands of rows and the note-outcome comparison only needs the
 *  notes that went out. */
async function fetchRegularSubmittedRuns(sinceIso: string): Promise<RunRow[]> {
  const rows = await fetchAllPages<RunRow>((from, to) =>
    supabase
      .from("pipeline_runs")
      .select(RUN_COLUMNS)
      .eq("outcome", "submitted")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  return rows.filter((r) => r.ab_test_picks?.misinfo_monitoring !== "yes");
}

async function fetchNotes(noteIds: string[]): Promise<Map<string, NoteRow>> {
  const notes = new Map<string, NoteRow>();
  for (let i = 0; i < noteIds.length; i += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("notes")
      .select("note_id, cn_status, view_count, rating_count, helpful_count, not_helpful_count")
      .in("note_id", noteIds.slice(i, i + PAGE_SIZE));
    if (error) throw new Error(error.message);
    for (const note of (data ?? []) as NoteRow[]) notes.set(note.note_id, note);
  }
  return notes;
}

function tally<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function summarizeNotes(label: string, runs: RunRow[], notes: Map<string, NoteRow>) {
  const submitted = runs.filter((r) => r.outcome === "submitted" && r.note_id);
  const noteRows = submitted.map((r) => notes.get(r.note_id!)).filter((n): n is NoteRow => !!n);
  const statuses = tally(noteRows, (n) => n.cn_status ?? "unknown");
  const helpful = statuses["CURRENTLY_RATED_HELPFUL"] ?? 0;
  const views = noteRows.reduce((sum, n) => sum + (n.view_count ?? 0), 0);
  const ratings = noteRows.reduce((sum, n) => sum + n.rating_count, 0);
  console.log(`\n${label}`);
  console.log(`  submitted notes: ${submitted.length} (${noteRows.length} found in notes table)`);
  console.log(`  cn_status tally: ${JSON.stringify(statuses)}`);
  console.log(`  rated helpful:   ${helpful} (${noteRows.length ? ((100 * helpful) / noteRows.length).toFixed(1) : "0"}%)`);
  console.log(`  total views:     ${views.toLocaleString()}  total ratings: ${ratings}`);
}

async function main() {
  const topicRuns = await fetchTopicRuns();
  if (topicRuns.length === 0) {
    console.log("No topic-based runs found at all.");
    return;
  }
  const firstAt = topicRuns[0].created_at;
  const lastAt = topicRuns[topicRuns.length - 1].created_at;
  const totalCost = topicRuns.reduce((sum, r) => sum + (r.cost ?? 0), 0);

  console.log(`Topic-based (misinfo-monitoring) runs: ${topicRuns.length}`);
  console.log(`Window: ${firstAt} .. ${lastAt}`);
  console.log(`Total LLM cost of topic runs: $${totalCost.toFixed(2)}`);
  console.log(`\nRuns per topic: ${JSON.stringify(tally(topicRuns, (r) => r.ab_test_picks?.misinfo_topic ?? "unknown"), null, 2)}`);
  console.log(`\nOutcomes: ${JSON.stringify(tally(topicRuns, (r) => `${r.outcome}${r.outcome_reason ? `/${r.outcome_reason}` : ""}`), null, 2)}`);

  const regularRuns = await fetchRegularSubmittedRuns(firstAt);
  const allNoteIds = [...topicRuns, ...regularRuns].filter((r) => r.note_id).map((r) => r.note_id!);
  const notes = await fetchNotes(allNoteIds);

  summarizeNotes("TOPIC-BASED NOTES", topicRuns, notes);
  for (const [topicId] of Object.entries(tally(topicRuns, (r) => r.ab_test_picks?.misinfo_topic ?? "unknown"))) {
    summarizeNotes(
      `  topic: ${topicId}`,
      topicRuns.filter((r) => (r.ab_test_picks?.misinfo_topic ?? "unknown") === topicId),
      notes,
    );
  }
  summarizeNotes("REGULAR NOTES (same window, submitted only)", regularRuns, notes);

  console.log("\nPer-note detail (topic-based, submitted):");
  for (const run of topicRuns.filter((r) => r.outcome === "submitted" && r.note_id)) {
    const note = notes.get(run.note_id!);
    console.log(
      `  ${run.created_at.slice(0, 10)}  ${run.ab_test_picks?.misinfo_topic}  ${run.note_id}` +
        `  status=${note?.cn_status ?? "?"}  views=${note?.view_count ?? "?"}` +
        `  ratings=${note?.rating_count ?? "?"} (H${note?.helpful_count ?? "?"}/NH${note?.not_helpful_count ?? "?"})  tweet=${run.tweet_id}`,
    );
  }
}

await main();
