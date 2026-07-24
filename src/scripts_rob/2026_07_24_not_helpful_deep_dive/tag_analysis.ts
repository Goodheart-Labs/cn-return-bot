/**
 * Not-Helpful deep dive, analysis 1 — reason-tag distributions on our topic
 * notes (read-only).
 *
 * Master question for the day: is it the notes or the audience? This first
 * cut asks WHAT raters say when they reject us. Tag counts come from
 * note_ratings_from_public_dump (synced daily from the public dump; carries
 * helpful_tag_counts / not_helpful_tag_counts for our own notes only).
 * Tags are multi-select per rating, so rates are normalized per rating of
 * the matching polarity ("X% of not-helpful ratings ticked this tag"), not
 * per tag-total.
 *
 * Cohort split at the velocity-experiment merge (fa6fb9b,
 * 2026-07-21T02:25:09Z): pre-experiment notes rode slow posts (few raters
 * present), post-experiment notes rode fast posts (raters demonstrably
 * present). All rated notes are PRE-#303 — this indicts the old writer, not
 * the current steering.
 *
 *   bun run src/scripts_rob/2026_07_24_not_helpful_deep_dive/tag_analysis.ts
 */

import { writeFileSync } from "node:fs";
import { SupabaseLogger } from "../../api/supabaseClient";

const TOPIC_ID = "trump_election_security";
const EXPERIMENT_MERGE = "2026-07-21T02:25:09Z";
const OUT = `${import.meta.dir}/tag_analysis.json`;

const logger = new SupabaseLogger();
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

// ── Canonical topic join: sightings → runs → notes (same as export_notes) ───
const sightings = await logger.fetchAllRows<{ id: number; processed_run_id: string | null }>(
  (c) => c.from("misinfo_monitoring_sightings")
    .select("id, processed_run_id")
    .eq("topic_id", TOPIC_ID)
    .not("processed_run_id", "is", null),
  "id", "processed sightings");

const runs: { id: string; note_id: string | null }[] = [];
for (const ids of chunk(sightings.map((s) => s.processed_run_id!), 100)) {
  runs.push(...await logger.fetchAllRows<(typeof runs)[number]>(
    (c) => c.from("pipeline_runs").select("id, note_id").in("id", ids), "id"));
}
const noteIds = [...new Set(runs.filter((r) => r.note_id).map((r) => r.note_id!))];

const notes: { note_id: string; submitted_at: string | null; note_text: string | null }[] = [];
for (const ids of chunk(noteIds, 100)) {
  notes.push(...await logger.fetchAllRows<(typeof notes)[number]>(
    (c) => c.from("notes").select("note_id, submitted_at, note_text").in("note_id", ids), "note_id"));
}
notes.sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));

interface RatingRow {
  note_id: string;
  helpful_count: number | null;
  somewhat_helpful_count: number | null;
  not_helpful_count: number | null;
  helpful_tag_counts: Record<string, number> | null;
  not_helpful_tag_counts: Record<string, number> | null;
}
const ratingRows: RatingRow[] = [];
for (const ids of chunk(noteIds, 100)) {
  ratingRows.push(...await logger.fetchAllRows<RatingRow>(
    (c) => c.from("note_ratings_from_public_dump")
      .select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count, helpful_tag_counts, not_helpful_tag_counts")
      .in("note_id", ids),
    "note_id"));
}
const ratingByNote = new Map(ratingRows.map((r) => [r.note_id, r]));

// ── Aggregate ────────────────────────────────────────────────────────────────
const pretty = (tag: string) =>
  tag.replace(/^(notHelpful|helpful)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();

interface Agg { notes: number; helpful: number; somewhat: number; not: number; hTags: Map<string, number>; nhTags: Map<string, number> }
const mkAgg = (): Agg => ({ notes: 0, helpful: 0, somewhat: 0, not: 0, hTags: new Map(), nhTags: new Map() });
const addInto = (a: Agg, r: RatingRow) => {
  a.notes++;
  a.helpful += r.helpful_count ?? 0;
  a.somewhat += r.somewhat_helpful_count ?? 0;
  a.not += r.not_helpful_count ?? 0;
  for (const [t, n] of Object.entries(r.helpful_tag_counts ?? {})) a.hTags.set(t, (a.hTags.get(t) ?? 0) + n);
  for (const [t, n] of Object.entries(r.not_helpful_tag_counts ?? {})) a.nhTags.set(t, (a.nhTags.get(t) ?? 0) + n);
};

const all = mkAgg();
const pre = mkAgg();
const post = mkAgg();
const perNote: object[] = [];
for (const n of notes) {
  const r = ratingByNote.get(n.note_id);
  const cohort = (n.submitted_at ?? "") < EXPERIMENT_MERGE ? "pre" : "post";
  if (r && ((r.helpful_count ?? 0) + (r.somewhat_helpful_count ?? 0) + (r.not_helpful_count ?? 0)) > 0) {
    addInto(all, r);
    addInto(cohort === "pre" ? pre : post, r);
  }
  const topNh = Object.entries(r?.not_helpful_tag_counts ?? {})
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([t, c]) => `${c}× ${pretty(t)}`).join(", ");
  perNote.push({
    note_id: n.note_id,
    submitted_at: n.submitted_at,
    cohort,
    helpful: r?.helpful_count ?? 0,
    somewhat: r?.somewhat_helpful_count ?? 0,
    not_helpful: r?.not_helpful_count ?? 0,
    top_not_helpful_tags: topNh || null,
  });
}

const tagTable = (a: Agg, which: "hTags" | "nhTags", denom: number) =>
  [...a[which].entries()].sort((x, y) => y[1] - x[1])
    .map(([t, n]) => ({ tag: pretty(t), count: n, pct_of_ratings: denom ? Number((100 * n / denom).toFixed(1)) : null }));

const summarize = (label: string, a: Agg) => ({
  label,
  rated_notes: a.notes,
  ratings: { helpful: a.helpful, somewhat: a.somewhat, not_helpful: a.not },
  helpful_tag_rates: tagTable(a, "hTags", a.helpful + a.somewhat),
  not_helpful_tag_rates: tagTable(a, "nhTags", a.not),
});

const result = {
  generated_at: new Date().toISOString(),
  note: "tag pct = % of ratings of that polarity ticking the tag (multi-select); all rated notes are pre-#303",
  cohort_boundary: EXPERIMENT_MERGE,
  aggregate: summarize("all rated notes", all),
  pre_experiment: summarize("pre-experiment (slow posts)", pre),
  post_experiment: summarize("post-experiment (fast posts)", post),
  per_note: perNote,
};
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`→ ${OUT}\n`);

// ── Digest ───────────────────────────────────────────────────────────────────
const show = (s: ReturnType<typeof summarize>) => {
  const r = s.ratings;
  console.log(`== ${s.label}: ${s.rated_notes} notes, ${r.helpful}/${r.somewhat}/${r.not_helpful} (h/sh/nh) ==`);
  console.log(`  not-helpful tags (% of ${r.not_helpful} NH ratings):`);
  for (const t of s.not_helpful_tag_rates) console.log(`    ${String(t.pct_of_ratings).padStart(5)}%  ${t.tag}  (${t.count})`);
  console.log(`  helpful tags (% of ${r.helpful + r.somewhat} H+SH ratings):`);
  for (const t of s.helpful_tag_rates) console.log(`    ${String(t.pct_of_ratings).padStart(5)}%  ${t.tag}  (${t.count})`);
  console.log("");
};
show(result.aggregate);
show(result.pre_experiment);
show(result.post_experiment);

console.log("== per-note (submitted order) ==");
for (const n of perNote as any[]) {
  console.log(`${(n.submitted_at ?? "?").slice(0, 16)}  ${n.cohort.padEnd(4)} ${String(n.helpful).padStart(3)}/${String(n.somewhat).padStart(2)}/${String(n.not_helpful).padStart(3)}  ${n.top_not_helpful_tags ?? "—"}`);
}
