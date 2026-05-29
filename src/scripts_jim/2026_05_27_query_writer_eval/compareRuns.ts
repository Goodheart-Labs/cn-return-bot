/**
 * Compare all runs in datasets/query_writer_eval/runs/ for a given split.
 *
 *   bun run src/scripts_jim/2026_05_27_query_writer_eval/compareRuns.ts \
 *     --split val
 *
 * Optionally pass --judge to recompute the LLM judge for any run that
 * lacks a judge.jsonl file.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../../datasets/query_writer_eval");
const RUNS = path.join(ROOT, "runs");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1];
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

interface Summary {
  variant: string;
  split: string;
  n: number;
  hit_url_pct: number;
  hit_domain_pct: number;
  judge_sufficient_pct?: number;
  avg_queries: number;
  empty_query_rows: number;
  per_category: Record<string, any>;
  runDir: string;
}

function readSummary(runDir: string): Summary | null {
  const sumPath = path.join(runDir, "summary.json");
  if (!fs.existsSync(sumPath)) return null;
  const data = JSON.parse(fs.readFileSync(sumPath, "utf8"));
  data.runDir = runDir;
  if (data.judge_sufficient_pct == null) {
    const judgePath = path.join(runDir, "judge.jsonl");
    if (fs.existsSync(judgePath)) {
      const verdicts = fs
        .readFileSync(judgePath, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const sufficient = verdicts.filter((v) => v.sufficient).length;
      data.judge_sufficient_pct = 100 * sufficient / verdicts.length;
    }
  }
  return data;
}

async function main() {
  const split = arg("split", "val")!;
  const wantJudge = flag("judge");
  const runs = fs.readdirSync(RUNS).filter((d) => d.endsWith(`__${split}__`) || d.includes(`__${split}__`));

  // Keep the latest run per variant
  const latest = new Map<string, { ts: number; dir: string }>();
  for (const r of runs) {
    const m = r.match(/^(.+)__([^_]+)__(\d+)$/);
    if (!m) continue;
    const variant = m[1]!;
    const rsplit = m[2]!;
    const ts = parseInt(m[3]!, 10);
    if (rsplit !== split) continue;
    if (!latest.has(variant) || latest.get(variant)!.ts < ts) {
      latest.set(variant, { ts, dir: path.join(RUNS, r) });
    }
  }

  if (wantJudge) {
    for (const [variant, { dir }] of latest) {
      const judgePath = path.join(dir, "judge.jsonl");
      if (fs.existsSync(judgePath)) continue;
      console.log(`Judging ${variant}...`);
      const { judgeAllRows } = await import("./judgeRows");
      const rows = fs
        .readFileSync(path.join(dir, "rows.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const verdicts = await judgeAllRows(rows);
      fs.writeFileSync(judgePath, verdicts.map((v) => JSON.stringify(v)).join("\n"));
      // Update summary.json
      const sumPath = path.join(dir, "summary.json");
      const summary = JSON.parse(fs.readFileSync(sumPath, "utf8"));
      const sufficient = verdicts.filter((v) => v.sufficient).length;
      summary.judge_sufficient_pct = 100 * sufficient / verdicts.length;
      fs.writeFileSync(sumPath, JSON.stringify(summary, null, 2));
    }
  }

  const summaries: Summary[] = [];
  for (const [variant, { dir }] of latest) {
    const s = readSummary(dir);
    if (s) summaries.push(s);
  }

  summaries.sort((a, b) => (b.judge_sufficient_pct ?? -1) - (a.judge_sufficient_pct ?? -1));

  console.log(`\nSplit: ${split}, runs: ${summaries.length}\n`);
  console.log("variant".padEnd(28), "JUDGE%".padStart(8), "domain%".padStart(10), "url%".padStart(8), "avg_q".padStart(8), "empty");
  console.log("-".repeat(75));
  for (const s of summaries) {
    const judge = s.judge_sufficient_pct == null ? "  —" : s.judge_sufficient_pct.toFixed(1);
    console.log(
      s.variant.padEnd(28),
      judge.padStart(8),
      s.hit_domain_pct.toFixed(1).padStart(10),
      s.hit_url_pct.toFixed(1).padStart(8),
      s.avg_queries.toFixed(2).padStart(8),
      String(s.empty_query_rows).padStart(6)
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
