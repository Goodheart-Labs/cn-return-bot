/**
 * Re-run ONLY the rows whose query writer first returned [] (the rows the
 * retry-on-empty fix changes), patch them into the saved per-variant results,
 * and recompute the full metrics. Re-runs all empty-query rows — both the
 * wants_note FNs AND the no_note rows that correctly exited empty — so the
 * corrected numbers reflect the retry's cost on both classes, not just the win.
 *
 *   bun run src/scripts_jim/2026_06_06_deepseek_note_filter/rerunEmpty.ts
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { join } from "path";
import type { Post } from "../../api/fetchEligiblePosts";
import { runRowAllVariants, VARIANTS, type DatasetRow, type RowResult } from "./pipeline";
import { writeVariantOutputs, formatMetrics, computeMetrics } from "./scoring";

const dir = import.meta.dir;
const ROW_CONCURRENCY = 5;

async function runPool<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function loop() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i]);
      process.stdout.write(`  rerun ${i + 1}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(ROW_CONCURRENCY, items.length) }, loop));
  return out;
}

async function main() {
  const dataset: DatasetRow[] = JSON.parse(readFileSync(join(dir, "dataset.json"), "utf8"));
  const posts: { runId: string; post: Post }[] = JSON.parse(readFileSync(join(dir, "posts.json"), "utf8"));
  const postByRun = new Map(posts.map((p) => [p.runId, p.post]));
  const rowByRun = new Map(dataset.map((r) => [r.runId, r]));

  // Empty-query rows = query-gen is shared per row, so base-neutral tells us.
  const baseNeutral: RowResult[] = JSON.parse(readFileSync(join(dir, "results_base-neutral.json"), "utf8"));
  const emptyRunIds = baseNeutral.filter((r) => (r.queries?.length ?? 0) === 0).map((r) => r.runId);
  console.log(`Re-running ${emptyRunIds.length} empty-query rows with retry-on-empty\n`);

  const rerun = await runPool(emptyRunIds, (runId) =>
    runRowAllVariants(rowByRun.get(runId)!, postByRun.get(runId)!),
  );
  const newResults = rerun.flat();
  const newByKey = new Map(newResults.map((r) => [`${r.runId}|${r.variant}`, r]));

  // Show what flipped (base-neutral view).
  console.log("\nPer-row outcome (base-neutral): label  attempts  before->after");
  for (const runId of emptyRunIds) {
    const before = baseNeutral.find((r) => r.runId === runId)!;
    const after = newByKey.get(`${runId}|base-neutral`)!;
    console.log(`  ${before.label.padEnd(10)} att=${after.queryAttempts}  ${before.predNeedsNote} -> ${after.predNeedsNote}  | ${(before.tweetText ?? "").slice(0, 55).replace(/\n/g, " ")}`);
  }

  console.log("\n=== corrected metrics ===");
  const allMetrics = [];
  for (const v of VARIANTS) {
    const path = join(dir, `results_${v.key}.json`);
    const backup = join(dir, `results_${v.key}.preRetry.json`);
    if (!existsSync(backup)) copyFileSync(path, backup); // preserve the pre-fix run

    const old: RowResult[] = JSON.parse(readFileSync(backup, "utf8"));
    const merged = old.map((r) => newByKey.get(`${r.runId}|${v.key}`) ?? r);

    const before = computeMetrics(v.key, old);
    const m = writeVariantOutputs(dir, v.key, merged); // rewrites results_/fn_/fp_
    allMetrics.push(m);
    console.log(`\n--- ${v.key} ---`);
    console.log(`  BEFORE: FN ${before.fn}/${before.positives} (${(before.falseNegativeRate! * 100).toFixed(0)}%)  filtered ${before.tn}/${before.negatives} (${(before.correctlyFilteredRate! * 100).toFixed(0)}%)`);
    console.log(formatMetrics(m));
  }

  writeFileSync(join(dir, "metrics.json"), JSON.stringify(allMetrics, null, 2));
  console.log(`\nPatched results_*, false_negatives_*, false_positives_*, metrics.json. Originals saved as results_*.preRetry.json`);
}

main().then(() => process.exit(0));
