/**
 * CLI driver: bun run src/scripts_jim/2026_05_27_query_writer_eval/runEval.ts
 *
 * Args:
 *   --variant <name>     prompt variant in datasets/query_writer_eval/prompts/<name>.md
 *   --split <name>       val | test | few_shot_pool | train | all_candidates
 *   --limit <n>          run only first N rows (smoke test)
 *   --concurrency <n>    parallel rows (default 5)
 *   --engines <csv>      override search engines (default google,bing,duckduckgo)
 *   --model <id>         override model (default deepseek/deepseek-v4-flash)
 */

import "dotenv/config";
import { runSplit } from "./evalHarness";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1];
}

async function main() {
  const variant = arg("variant", "v0_baseline")!;
  const split = arg("split", "val")!;
  const limit = arg("limit");
  const concurrency = arg("concurrency");
  const engines = arg("engines");
  const model = arg("model");
  await runSplit({
    variant,
    split,
    limit: limit ? parseInt(limit) : undefined,
    concurrency: concurrency ? parseInt(concurrency) : undefined,
    engines,
    model,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
