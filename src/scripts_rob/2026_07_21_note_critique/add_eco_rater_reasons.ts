/**
 * Aggregate the stream-filtered public-dump ratings (target_ratings.tsv from
 * the scratchpad filter job) into per-note tag counts for the 9 ecosystem
 * notes, and swap WINNERS_REVIEW.md's placeholder "**Rater reasons:**" lines
 * for the real numbers. Only replaces lines this tooling generated — Rob's
 * annotations are never anchors. Idempotent.
 *
 *   bun run src/scripts_rob/2026_07_21_note_critique/add_eco_rater_reasons.ts <path-to-target_ratings.tsv>
 */

import { readFileSync, writeFileSync } from "node:fs";

const DIR = "src/scripts_rob/2026_07_21_note_critique";
const tsvPath = process.argv[2];
if (!tsvPath) {
  console.error("usage: bun run add_eco_rater_reasons.ts <target_ratings.tsv>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(`${DIR}/corpus.json`, "utf8"));
const OFF_TOPIC = new Set([
  "2072241845933891762", "2072223139837190425", "2068073354192400514",
  "2070675535592869974", "2076933746696036532",
]);
const shown = raw.shown.filter((n: any) => !OFF_TOPIC.has(n.noteId))
  .sort((a: any, b: any) => (a.hoursToStatus ?? 1e9) - (b.hoursToStatus ?? 1e9));
const notHelpful = raw.notHelpful.filter((n: any) => !OFF_TOPIC.has(n.noteId));
const noteIdByHeading = new Map<string, string>();
shown.forEach((n: any, i: number) => noteIdByHeading.set(`W${i + 1}`, n.noteId));
notHelpful.forEach((n: any, i: number) => noteIdByHeading.set(`N${i + 1}`, n.noteId));

// ── Parse the filtered TSV ──────────────────────────────────────────────────
// Format: first line "HEADER\t<original header>"; data lines "<partition>\t<original row>".
const lines = readFileSync(tsvPath, "utf8").split("\n").filter(Boolean);
const headerLine = lines.find((l) => l.startsWith("HEADER\t"));
if (!headerLine) throw new Error("no HEADER line in filtered tsv");
const cols = headerLine.split("\t").slice(1);
const idx = new Map(cols.map((c, i) => [c, i]));
const noteIdCol = idx.get("noteId");
const levelCol = idx.get("helpfulnessLevel");
if (noteIdCol === undefined || levelCol === undefined) throw new Error(`missing noteId/helpfulnessLevel in header: ${cols.slice(0, 12).join(",")}`);
const tagCols = cols
  .map((c, i) => ({ c, i }))
  .filter(({ c }) => /^(helpful|notHelpful)[A-Z]/.test(c) && c !== "helpfulnessLevel");

interface Agg { helpful: number; somewhat: number; not: number; tags: Map<string, number> }
const aggs = new Map<string, Agg>();
const seen = new Set<string>(); // partition overlap guard: noteId+rater dedupe
const raterCol = idx.get("raterParticipantId");
for (const line of lines) {
  if (line.startsWith("HEADER\t")) continue;
  const parts = line.split("\t");
  const row = parts.slice(1);
  const noteId = row[noteIdCol]!;
  const dedupeKey = `${noteId}:${raterCol !== undefined ? row[raterCol] : parts.join("|")}`;
  if (seen.has(dedupeKey)) continue;
  seen.add(dedupeKey);
  const a = aggs.get(noteId) ?? { helpful: 0, somewhat: 0, not: 0, tags: new Map() };
  const level = row[levelCol];
  if (level === "HELPFUL") a.helpful++;
  else if (level === "SOMEWHAT_HELPFUL") a.somewhat++;
  else if (level === "NOT_HELPFUL") a.not++;
  for (const { c, i } of tagCols) {
    if (row[i] === "1") a.tags.set(c, (a.tags.get(c) ?? 0) + 1);
  }
  aggs.set(noteId, a);
}
console.log(`aggregated ${seen.size} ratings across ${aggs.size} notes`);

const pretty = (tag: string) =>
  tag.replace(/^(notHelpful|helpful)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
function reasonLine(noteId: string): string {
  const a = aggs.get(noteId);
  if (!a) return `**Rater reasons:** *(no ratings found in dump partitions scanned)*`;
  const fmt = (pred: (t: string) => boolean) =>
    [...a.tags.entries()].filter(([t]) => pred(t)).sort((x, y) => y[1] - x[1])
      .map(([t, n]) => `${n}× ${pretty(t)}`).join(", ");
  const h = fmt((t) => t.startsWith("helpful"));
  const nh = fmt((t) => t.startsWith("notHelpful"));
  const parts = [`${a.helpful} helpful / ${a.somewhat} somewhat / ${a.not} not`];
  if (h) parts.push(`helpful: ${h}`);
  if (nh) parts.push(`not-helpful: ${nh}`);
  return `**Rater reasons:** ${parts.join(" · ")}`;
}

const path = `${DIR}/WINNERS_REVIEW.md`;
const doc = readFileSync(path, "utf8").split("\n");
let heading: string | null = null;
let replaced = 0;
const out = doc.map((line) => {
  const m = line.match(/^## ([WN]\d+) —/);
  if (m) heading = m[1]!;
  if (heading && noteIdByHeading.has(heading) && line.startsWith("**Rater reasons:**")) {
    replaced++;
    return reasonLine(noteIdByHeading.get(heading)!);
  }
  return line;
});
writeFileSync(path, out.join("\n"));
console.log(`WINNERS_REVIEW.md: replaced ${replaced} rater-reason line(s)`);
