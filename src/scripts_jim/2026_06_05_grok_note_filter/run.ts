/**
 * Run the Grok note-filter over the labeled dataset, both prompt versions,
 * and write per-version results + metrics + false-negative/positive JSONs
 * (scoring lives in scoring.ts, shared with recompute.ts).
 *
 *   bun run src/scripts_jim/2026_06_05_grok_note_filter/run.ts            # all 100, both versions
 *   bun run src/scripts_jim/2026_06_05_grok_note_filter/run.ts 10         # first 10 rows (smoke)
 *   bun run src/scripts_jim/2026_06_05_grok_note_filter/run.ts 100 neutral
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { grokNeedsNote, GROK_MODEL, type PromptVersion } from "./filter";
import { writeScoringOutputs, formatMetrics, type RowResult } from "./scoring";
import type { DatasetRow } from "./buildDataset";

const CONCURRENCY = 8;
const MAX_ATTEMPTS = 3; // retry rows where Grok returns no parseable decision

async function runOne(row: DatasetRow, version: PromptVersion): Promise<RowResult> {
  let res = await grokNeedsNote(row.tweetUrl, version);
  for (let attempt = 2; attempt <= MAX_ATTEMPTS && res.needsNote === null; attempt++) {
    res = await grokNeedsNote(row.tweetUrl, version);
  }
  return {
    runId: row.runId,
    tweetId: row.tweetId,
    tweetUrl: row.tweetUrl,
    label: row.label as "wants_note" | "no_note",
    outcome: row.outcome,
    outcomeReason: row.outcomeReason,
    tweetText: row.tweetText,
    grokNeedsNote: res.needsNote,
    grokReason: res.reason,
    searchCalls: res.searchCalls,
    citations: res.citations,
    costUsd: res.cost?.cost ?? null,
    error: res.error,
  };
}

async function runPool<T, R>(items: T[], worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function loop() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
      done++;
      if (done % 10 === 0 || done === items.length) process.stdout.write(`    ${done}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, loop));
  return out;
}

async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
  const onlyVersion = process.argv[3] as PromptVersion | undefined;
  const dir = import.meta.dir;
  const dataset: DatasetRow[] = JSON.parse(readFileSync(join(dir, "dataset.json"), "utf8"));
  const rows = Number.isFinite(limit) ? dataset.slice(0, limit) : dataset;

  const versions: PromptVersion[] = onlyVersion ? [onlyVersion] : ["neutral", "lenient"];
  console.log(`Model=${GROK_MODEL}  rows=${rows.length}  versions=${versions.join(",")}\n`);

  const allMetrics = [];
  for (const version of versions) {
    console.log(`=== version: ${version} ===`);
    const results = await runPool(rows, (row) => runOne(row, version));
    const m = writeScoringOutputs(dir, version, results);
    allMetrics.push(m);
    console.log(formatMetrics(m) + "\n");
  }

  writeFileSync(join(dir, "metrics.json"), JSON.stringify(allMetrics, null, 2));
  console.log(`Wrote results_*, false_negatives_*, false_positives_*, metrics.json to ${dir}`);
}

main().then(() => process.exit(0));
