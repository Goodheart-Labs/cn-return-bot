/**
 * Insert or refresh the "**Rater reasons:**" line in each review-doc entry
 * from the public dump's per-note tag counts (helpful_tag_counts /
 * not_helpful_tag_counts in note_ratings_from_public_dump). Existing lines
 * are replaced IN PLACE — but only lines this tooling generated (they all
 * start with "**Rater reasons:**"); Rob's hand annotations are never
 * anchors, so they're safe. Entries with no dump row get an explicit
 * "none in dump yet" so silence isn't ambiguous. Idempotent.
 *
 *   bun run src/scripts_rob/2026_07_21_note_critique/add_rater_reasons.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { getSupabaseClient } from "../../api/supabaseClient";

const DIR = "src/scripts_rob/2026_07_21_note_critique";

const raw = JSON.parse(readFileSync(`${DIR}/corpus.json`, "utf8"));
const OFF_TOPIC = new Set([
  "2072241845933891762", "2072223139837190425", "2068073354192400514",
  "2070675535592869974", "2076933746696036532",
]);
const shown = raw.shown.filter((n: any) => !OFF_TOPIC.has(n.noteId))
  .sort((a: any, b: any) => (a.hoursToStatus ?? 1e9) - (b.hoursToStatus ?? 1e9));
const notHelpful = raw.notHelpful.filter((n: any) => !OFF_TOPIC.has(n.noteId));
const statusRank = (s: string | null) =>
  s === "CURRENTLY_RATED_HELPFUL" ? 0 : s === "CURRENTLY_RATED_NOT_HELPFUL" ? 1 : 2;
const ours = [...raw.ours].sort((a: any, b: any) =>
  statusRank(a.status) - statusRank(b.status) || a.submittedAt.localeCompare(b.submittedAt));

const noteIdByHeading = new Map<string, string>();
shown.forEach((n: any, i: number) => noteIdByHeading.set(`W${i + 1}`, n.noteId));
notHelpful.forEach((n: any, i: number) => noteIdByHeading.set(`N${i + 1}`, n.noteId));
ours.forEach((n: any, i: number) => noteIdByHeading.set(`O${i + 1}`, n.noteId));

const c = getSupabaseClient();
const { data: rows, error } = await c
  .from("note_ratings_from_public_dump")
  .select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count, helpful_tag_counts, not_helpful_tag_counts")
  .in("note_id", [...noteIdByHeading.values()]);
if (error) throw error;
const byNoteId = new Map(rows.map((r) => [r.note_id, r]));

// "helpfulGoodSources" -> "good sources"; "notHelpfulSourcesMissingOrUnreliable" -> "sources missing or unreliable"
const pretty = (tag: string) =>
  tag.replace(/^(notHelpful|helpful)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
const fmtTags = (counts: Record<string, number> | null) =>
  Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n}× ${pretty(t)}`)
    .join(", ");

function reasonLine(noteId: string): string {
  const r = byNoteId.get(noteId);
  if (!r) return `**Rater reasons:** *(no ratings in the public dump yet — ~48h lag)*`;
  const parts = [`${r.helpful_count} helpful / ${r.somewhat_helpful_count ?? 0} somewhat / ${r.not_helpful_count} not`];
  const h = fmtTags(r.helpful_tag_counts);
  const nh = fmtTags(r.not_helpful_tag_counts);
  if (h) parts.push(`helpful: ${h}`);
  if (nh) parts.push(`not-helpful: ${nh}`);
  return `**Rater reasons:** ${parts.join(" · ")}`;
}

for (const file of ["WINNERS_REVIEW.md", "OURS_REVIEW.md"]) {
  const path = `${DIR}/${file}`;
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const out: string[] = [];
  let added = 0;
  let refreshed = 0;
  let currentHeading: string | null = null;
  const entryHasReasons = new Set<string>();
  // First pass: register every entry that already carries a reasons line —
  // the insert below must never fire for them, even when the refresh guard
  // (no dump row, e.g. all W/N ecosystem entries) leaves the line untouched.
  {
    let h: string | null = null;
    for (const line of lines) {
      const m = line.match(/^## ([WNO]\d+) —/);
      if (m) h = m[1]!;
      if (h && line.startsWith("**Rater reasons:**")) entryHasReasons.add(h);
    }
  }
  for (const line of lines) {
    const m = line.match(/^## ([WNO]\d+) —/);
    if (m) currentHeading = m[1]!;
    // Refresh an existing tooling-generated line in place — but only when we
    // have a dump row to refresh FROM. Ecosystem notes (W/N) never appear in
    // note_ratings_from_public_dump (that table only tracks our own notes);
    // their lines were filled by add_eco_rater_reasons and must not be
    // clobbered with placeholders here.
    if (
      currentHeading
      && noteIdByHeading.has(currentHeading)
      && byNoteId.has(noteIdByHeading.get(currentHeading)!)
      && line.startsWith("**Rater reasons:**")
    ) {
      out.push(reasonLine(noteIdByHeading.get(currentHeading)!));
      refreshed++;
      entryHasReasons.add(currentHeading);
      continue;
    }
    // Insert just above the annotation slot of entries with no line yet.
    if (
      currentHeading
      && noteIdByHeading.has(currentHeading)
      && !entryHasReasons.has(currentHeading)
      && /^\*\*(What worked|Why it failed|What I'd change)/.test(line)
    ) {
      out.push(reasonLine(noteIdByHeading.get(currentHeading)!), "");
      added++;
      entryHasReasons.add(currentHeading);
    }
    out.push(line);
  }
  writeFileSync(path, out.join("\n"));
  console.log(`${file}: added ${added}, refreshed ${refreshed} rater-reason line(s)`);
}
