/**
 * CLI: judge an existing run dir with the LLM judge.
 *
 *   bun run src/scripts_jim/2026_05_27_query_writer_eval/llmJudge.ts \
 *     --run datasets/query_writer_eval/runs/<run-dir>
 *
 * Reuses judgeAllRows from ./judgeRows.ts. Writes judge.jsonl and updates
 * summary.json in the run dir.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { judgeAllRows } from "./judgeRows";

async function main() {
  const runArg = process.argv[process.argv.indexOf("--run") + 1];
  if (!runArg) {
    console.error("Pass --run <run-dir>");
    process.exit(1);
  }
  const runDir = path.resolve(runArg);
  const rowsPath = path.join(runDir, "rows.jsonl");
  if (!fs.existsSync(rowsPath)) {
    console.error(`No rows.jsonl in ${runDir}`);
    process.exit(1);
  }

  const rows = fs.readFileSync(rowsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const verdicts = await judgeAllRows(rows);

  const sufficient = verdicts.filter((v) => v.sufficient).length;
  const summaryPath = path.join(runDir, "summary.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  summary.judge_sufficient_pct = 100 * sufficient / rows.length;

  // Add per-category judge breakdown
  const byCatJudge: Record<string, { n: number; pass: number }> = {};
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i]!.primary_category ?? "unknown";
    byCatJudge[c] ??= { n: 0, pass: 0 };
    byCatJudge[c].n++;
    if (verdicts[i]?.sufficient) byCatJudge[c].pass++;
  }
  for (const [c, v] of Object.entries(byCatJudge)) {
    if (summary.per_category[c]) {
      summary.per_category[c].judge_sufficient_pct = 100 * v.pass / v.n;
    }
  }

  fs.writeFileSync(path.join(runDir, "judge.jsonl"), verdicts.map((v) => JSON.stringify(v)).join("\n"));
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n${runDir}: judge_sufficient_pct = ${summary.judge_sufficient_pct.toFixed(1)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
