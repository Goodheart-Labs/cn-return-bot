/**
 * Summarises compare.ts's output: how many of the pages hosted Jina read the
 * self-hosted copy read too, how similar the texts are, and what it did on
 * the pages hosted Jina failed on.
 *
 * Usage: bun run src/scripts_jim/2026_11_23_self_hosted_jina/summarize.ts [<file>]
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

/** Self-hosted found the same page when its text has this share of the hosted
 *  text's distinct words. Pages with comments or feeds change over the days
 *  between the two reads, so they score lower. */
const SIMILAR_WORD_OVERLAP = 0.8;
/** A self-hosted text this many times longer than hosted's is reported apart,
 *  because every extra character is a token for the model that reads it. */
const MUCH_LONGER_FACTOR = 3;
const PASS_SHARE = 0.9;

interface Comparison {
  url: string;
  hosted: { result: string; status?: number; chars: number };
  selfHosted: { result: string; status?: number; reason?: string; chars: number; ms: number };
  wordOverlap: number | null;
}

const file = process.argv[2] ?? `${homedir()}/dev/data/goo-853/self-hosted.jsonl`;
const rows: Comparison[] = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

const hostedRead = rows.filter((row) => row.hosted.result === "good");
const bothRead = hostedRead.filter((row) => row.selfHosted.result === "good");
const similar = bothRead.filter((row) => isSimilar(row));
const hostedFailed = rows.filter((row) => row.hosted.result !== "good");
const onlySelfHosted = hostedFailed.filter((row) => row.selfHosted.result === "good");

console.log(`${rows.length} pages compared`);
console.log(`hosted Jina read ${hostedRead.length}. Self-hosted read ${bothRead.length} of them (${percent(bothRead.length, hostedRead.length)}), ${similar.length} with a similar text (${percent(similar.length, hostedRead.length)}).`);
console.log(`bar: ${PASS_SHARE * 100}% of hosted's reads with a similar text -> ${similar.length >= PASS_SHARE * hostedRead.length ? "PASSED" : "NOT PASSED"}`);
console.log(`hosted Jina failed on ${hostedFailed.length}. Self-hosted read ${onlySelfHosted.length} of those.`);
const muchLonger = bothRead.filter((row) => row.selfHosted.chars > MUCH_LONGER_FACTOR * row.hosted.chars);
console.log(`${muchLonger.length} of the pages both read came back more than ${MUCH_LONGER_FACTOR} times longer from self-hosted. Total characters: hosted ${sum(bothRead.map((row) => row.hosted.chars))}, self-hosted ${sum(bothRead.map((row) => row.selfHosted.chars))}.`);
console.log(`median time ${median(rows.map((row) => row.selfHosted.ms))} ms, slowest ${Math.max(...rows.map((row) => row.selfHosted.ms))} ms`);

console.log("\nWhat self-hosted did on the pages hosted Jina read:");
printCounts(hostedRead.map((row) => describe(row)));
console.log("\nWhat self-hosted did on the pages hosted Jina failed on, by hosted's result:");
printCounts(hostedFailed.map((row) => `${row.hosted.result.slice(0, 30)}${row.hosted.status ? ` ${row.hosted.status}` : ""} -> ${describe(row)}`));

console.log("\nPages hosted Jina read and self-hosted did not, or read differently:");
for (const row of hostedRead.filter((row) => !isSimilar(row))) {
  console.log(`  ${describe(row).padEnd(28)} hosted ${row.hosted.chars} chars, self-hosted ${row.selfHosted.chars}, overlap ${row.wordOverlap?.toFixed(2)}  ${row.url}`);
}

function isSimilar(row: Comparison): boolean {
  return row.selfHosted.result === "good" && (row.wordOverlap ?? 0) >= SIMILAR_WORD_OVERLAP;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function describe(row: Comparison): string {
  const { result, status } = row.selfHosted;
  if (result === "target_error") return `site answered ${status}`;
  if (result === "failed") return `failed${status ? ` HTTP ${status}` : ""}`;
  return result;
}

function printCounts(labels: string[]): void {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  for (const [label, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)}  ${label}`);
}

function percent(part: number, whole: number): string {
  return `${Math.round((100 * part) / Math.max(whole, 1))}%`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
