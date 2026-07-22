/**
 * Insert a "**Tweet:** <url>" line under each entry heading in the two review
 * docs, WITHOUT touching anything else (Rob's annotations live in these files).
 * Idempotent: entries that already have a Tweet line are skipped. Recomputes
 * the same entry orderings as make_review_docs.ts so headings map to the
 * right tweet ids.
 *
 *   bun run src/scripts_rob/2026_07_21_note_critique/add_tweet_urls.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

const DIR = "src/scripts_rob/2026_07_21_note_critique";
const url = (id: string) => `https://x.com/i/web/status/${id}`;

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

const idByHeading = new Map<string, string>();
shown.forEach((n: any, i: number) => idByHeading.set(`W${i + 1}`, n.tweetId));
notHelpful.forEach((n: any, i: number) => idByHeading.set(`N${i + 1}`, n.tweetId));
ours.forEach((n: any, i: number) => idByHeading.set(`O${i + 1}`, n.tweetId));

for (const file of ["WINNERS_REVIEW.md", "OURS_REVIEW.md"]) {
  const path = `${DIR}/${file}`;
  const lines = readFileSync(path, "utf8").split("\n");
  const out: string[] = [];
  let added = 0;
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]!);
    const m = lines[i]!.match(/^## ([WNO]\d+) —/);
    if (m && idByHeading.has(m[1]!) && !lines[i + 1]?.startsWith("**Tweet:**") && !lines[i + 2]?.startsWith("**Tweet:**")) {
      out.push("", `**Tweet:** ${url(idByHeading.get(m[1]!)!)}`);
      added++;
    }
  }
  writeFileSync(path, out.join("\n"));
  console.log(`${file}: added ${added} tweet URL line(s)`);
}
