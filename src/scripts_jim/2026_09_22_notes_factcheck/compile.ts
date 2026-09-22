// Join the reviewer verdicts with the input files. Prints a tally per creator
// and, with --recheck, writes one Fable re-check input per post holding only
// the notes the Opus pass did not reject, each with the Opus reason attached.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";

const DIR = "src/scripts_jim/2026_09_22_notes_factcheck";
const stage = process.argv.includes("--fable") ? "fable" : "opus";
const writeRecheck = process.argv.includes("--recheck");

type Verdict = "good" | "uncertain" | "bad";
interface Review { note_id: string; verdict: Verdict; reason: string; [k: string]: unknown }

const index = JSON.parse(await Bun.file(`${DIR}/items/index.json`).text()) as { file: string; project: string; creator: string; notes: number }[];
const tally: Record<string, { creator: string; reviewed: number; pending: number; good: number; uncertain: number; bad: number }> = {};
let missing = 0;
mkdirSync(`${DIR}/recheck`, { recursive: true });

for (const row of index) {
  const base = row.file.split("/").pop()!;
  const t = (tally[row.project] ??= { creator: row.creator, reviewed: 0, pending: 0, good: 0, uncertain: 0, bad: 0 });
  const reviewPath = `${DIR}/reviews/${stage}/${base}`;
  if (!existsSync(reviewPath)) { t.pending += row.notes; missing++; continue; }
  const item = JSON.parse(await Bun.file(row.file).text());
  const review = JSON.parse(await Bun.file(reviewPath).text());
  const byNote = new Map<string, Review>((review.notes as Review[]).map((n) => [n.note_id, n]));
  const kept: unknown[] = [];
  for (const note of item.notes) {
    const r = byNote.get(note.note_id);
    if (!r) { console.error(`missing verdict for ${note.note_id} in ${base}`); t.pending++; continue; }
    t.reviewed++;
    t[r.verdict]++;
    if (r.verdict !== "bad") kept.push({ ...note, opus_verdict: r.verdict, opus_reason: r.reason });
  }
  if (writeRecheck && stage === "opus" && kept.length > 0) {
    writeFileSync(`${DIR}/recheck/${base}`, JSON.stringify({ ...item, notes: kept }, null, 2));
  }
}

console.log(`stage=${stage}  posts without a review file: ${missing}`);
console.log("project | reviewed | good | uncertain | bad | pending");
const total = { reviewed: 0, good: 0, uncertain: 0, bad: 0, pending: 0 };
for (const [slug, t] of Object.entries(tally).sort()) {
  console.log(`${slug} | ${t.reviewed} | ${t.good} | ${t.uncertain} | ${t.bad} | ${t.pending}`);
  for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += t[k];
}
console.log(`TOTAL | ${total.reviewed} | ${total.good} | ${total.uncertain} | ${total.bad} | ${total.pending}`);
if (writeRecheck) console.log("recheck inputs:", readdirSync(`${DIR}/recheck`).length);
