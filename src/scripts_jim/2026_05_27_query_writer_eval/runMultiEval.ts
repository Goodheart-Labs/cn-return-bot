/**
 * Run several prompt variants sequentially over the same split.
 * Shares the search cache across variants so common queries cost nothing
 * after the first variant pays for them.
 *
 *   bun run src/scripts_jim/2026_05_27_query_writer_eval/runMultiEval.ts \
 *     --split val --variants v0_baseline,v3_cot,v4_no_abstain
 */

import "dotenv/config";
import { runSplit } from "./evalHarness";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1];
}

async function main() {
  const variantList = (arg("variants") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (variantList.length === 0) {
    console.error("Pass --variants v1,v2,v3");
    process.exit(1);
  }
  const split = arg("split", "val")!;
  const concurrency = arg("concurrency");
  const limit = arg("limit");
  const engines = arg("engines");
  const model = arg("model");

  const summaries: any[] = [];
  for (const v of variantList) {
    console.log(`\n>>>>>>>>>>>>>>>>> Running ${v} on ${split} <<<<<<<<<<<<<<<<<\n`);
    const { summary } = await runSplit({
      variant: v,
      split,
      concurrency: concurrency ? parseInt(concurrency) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      engines,
      model,
    });
    summaries.push(summary);
  }

  console.log("\n\n========= COMPARISON =========");
  console.log("variant".padEnd(28), "hit_domain%".padStart(12), "hit_url%".padStart(10), "avg_q".padStart(8), "empty");
  for (const s of summaries) {
    console.log(
      s.variant.padEnd(28),
      s.hit_domain_pct.toFixed(1).padStart(12),
      s.hit_url_pct.toFixed(1).padStart(10),
      s.avg_queries.toFixed(2).padStart(8),
      String(s.empty_query_rows).padStart(6)
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
