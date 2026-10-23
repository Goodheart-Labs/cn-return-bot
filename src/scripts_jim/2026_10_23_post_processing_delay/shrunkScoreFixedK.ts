/* The shrunk score with a hand-picked prior (GOO-549): every creator is
 * treated as if they also had K posts with one reader each, the typical
 * visited post. Shows the top of the ranking for a few K. */
import { readFileSync } from "fs";
type Row = { creator: string; n: number; s: number };
const rows = (JSON.parse(readFileSync(new URL("./perCreatorMoments.json", import.meta.url), "utf8")) as Row[]).map((r) => ({ creator: r.creator, n: Number(r.n), s: Number(r.s) }));
const PRIOR_READERS = 1;
const MIN_SCORE_TO_WALK = 1.5;
for (const k of [2, 3, 5]) {
  const score = (r: (typeof rows)[number]) => (r.s + k * PRIOR_READERS) / (r.n + k);
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  console.log(`\nK = ${k}: ${rows.filter((r) => score(r) >= MIN_SCORE_TO_WALK).length} creators at ${MIN_SCORE_TO_WALK} or more`);
  console.log(sorted.slice(0, 15).map((r, i) => `${String(i + 1).padStart(3)} ${r.creator.replace(/^https:\/\/(www\.)?/, "").slice(0, 34).padEnd(34)} ${score(r).toFixed(2)} (raw ${(r.s / r.n).toFixed(2)} over ${r.n})`).join("\n"));
}
