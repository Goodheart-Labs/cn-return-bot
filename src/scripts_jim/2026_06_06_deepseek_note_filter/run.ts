/**
 * Run the deepseek note-filter (all 4 variants) over the labeled dataset and
 * write per-variant results + metrics + false-negative/positive JSONs.
 *
 *   bun run src/scripts_jim/2026_06_06_deepseek_note_filter/run.ts        # all 100
 *   bun run src/scripts_jim/2026_06_06_deepseek_note_filter/run.ts 10     # first 10 rows
 *
 * All 4 variants share each row's query-gen + search, so one row = one call to
 * runRowAllVariants returning 4 RowResults.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Post } from "../../api/fetchEligiblePosts";
import { runRowAllVariants, VARIANTS, type DatasetRow, type RowResult } from "./pipeline";
import { writeVariantOutputs, formatMetrics } from "./scoring";

const ROW_CONCURRENCY = 6;

async function runPool<T, R>(items: T[], worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function loop() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
      done++;
      process.stdout.write(`  row ${done}/${items.length} done\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(ROW_CONCURRENCY, items.length) }, loop));
  return out;
}

async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
  const dir = import.meta.dir;
  const dataset: DatasetRow[] = JSON.parse(readFileSync(join(dir, "dataset.json"), "utf8"));
  const posts: { runId: string; post: Post }[] = JSON.parse(readFileSync(join(dir, "posts.json"), "utf8"));
  const postByRun = new Map(posts.map((p) => [p.runId, p.post]));
  const rows = (Number.isFinite(limit) ? dataset.slice(0, limit) : dataset).filter((r) => postByRun.has(r.runId));
  console.log(`deepseek note-filter — rows=${rows.length}, variants=${VARIANTS.map((v) => v.key).join(",")}\n`);

  const perRow = await runPool(rows, (row) => runRowAllVariants(row, postByRun.get(row.runId)!));
  const all: RowResult[] = perRow.flat();

  const allMetrics = [];
  for (const v of VARIANTS) {
    const results = all.filter((r) => r.variant === v.key);
    const m = writeVariantOutputs(dir, v.key, results);
    allMetrics.push(m);
    console.log(`=== ${v.key} ===\n${formatMetrics(m)}\n`);
  }

  writeFileSync(join(dir, "metrics.json"), JSON.stringify(allMetrics, null, 2));
  console.log(`Wrote results_*, false_negatives_*, false_positives_*, metrics.json to ${dir}`);
}

main().then(() => process.exit(0));
