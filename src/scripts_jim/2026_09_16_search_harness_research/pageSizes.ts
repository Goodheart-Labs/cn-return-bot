/**
 * How big are the pages our web_fetch tool hands the model? Reads the raw
 * fetch extract written by extract.ts and prints the size distribution of
 * successful fetches per caller, plus the share that hit the 20,000-character
 * cap. Run from the repo root: bun run src/scripts_jim/2026_09_16_search_harness_research/pageSizes.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/scripts_jim/2026_09_16_search_harness_research";
const MAX_RETURN_CHARS = 20_000;
const CHARS_PER_TOKEN = 4;

interface FetchCall { source: string; runId: string; kind: string; resultChars: number | null; durationMs: number | null }
const calls: FetchCall[] = JSON.parse(readFileSync(join(DIR, "raw_fetch_calls.json"), "utf8"));

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

// One GLM 5.2 run on 2026-09-03 made 2,605 web_fetch calls in a single turn,
// almost all of the same URL. It would dominate every X search-loop number, so
// any run with more fetches than this cap is left out and reported separately.
const RUNAWAY_FETCHES_PER_RUN = 50;
const fetchesPerRun = new Map<string, number>();
for (const c of calls) fetchesPerRun.set(c.runId, (fetchesPerRun.get(c.runId) ?? 0) + 1);
const runaway = new Set([...fetchesPerRun].filter(([, n]) => n > RUNAWAY_FETCHES_PER_RUN).map(([id]) => id));
console.log(`Runs left out as runaway (more than ${RUNAWAY_FETCHES_PER_RUN} fetches): ${[...runaway].map((id) => `${id} (${fetchesPerRun.get(id)} fetches)`).join(", ") || "none"}\n`);

const bySource = new Map<string, number[]>();
for (const c of calls) {
  if (c.kind !== "ok" || c.resultChars == null || runaway.has(c.runId)) continue;
  if (!bySource.has(c.source)) bySource.set(c.source, []);
  bySource.get(c.source)!.push(c.resultChars);
}

console.log("| Caller | Successful fetches | Median chars | p90 chars | Share at the 20,000 cap | Mean tokens per fetch (chars / 4) |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const [source, sizes] of bySource) {
  sizes.sort((a, b) => a - b);
  const capped = sizes.filter((s) => s >= MAX_RETURN_CHARS - 100).length;
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  console.log(`| ${source} | ${sizes.length} | ${percentile(sizes, 0.5)} | ${percentile(sizes, 0.9)} | ${(100 * capped / sizes.length).toFixed(1)}% | ${Math.round(mean / CHARS_PER_TOKEN)} |`);
}
