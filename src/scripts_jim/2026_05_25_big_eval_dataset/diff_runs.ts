/**
 * Diff two dataset_runs/<run>/ folders.
 *
 * Joins their results CSVs on `url` and emits:
 *   - aggregate deltas (PASS, FP rate, $/row if logs carry cost)
 *   - regression table (rows that flipped correct → incorrect)
 *   - win table       (rows that flipped incorrect → correct)
 *
 * Writes a markdown file at <new_run>/diff_vs_<base_run_name>.md and a
 * console summary.
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_25_big_eval_dataset/diff_runs.ts <base_run_folder> <new_run_folder>
 */

import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords } from "../../utils/csv";

interface RunRow {
  url: string;
  needs_note: string;
  note_text: string;
  outcome: string;
  result: string;
  judge_guidance: string;
}

function loadRun(folder: string): { name: string; rows: Map<string, RunRow> } {
  const csv = fs.readdirSync(folder).find((f) => f.startsWith("results_") && f.endsWith(".csv"));
  if (!csv) throw new Error(`no results_*.csv in ${folder}`);
  const records = parseCsvRecords(fs.readFileSync(path.join(folder, csv), "utf8").trim());
  const header = records[0]!.map((h) => h.trim());
  const idx = (k: string) => header.indexOf(k);
  const rows = new Map<string, RunRow>();
  for (let i = 1; i < records.length; i++) {
    const f = records[i]!;
    const url = f[idx("url")]?.trim() ?? "";
    if (!url) continue;
    rows.set(url, {
      url,
      needs_note: f[idx("needs_note")] ?? "",
      note_text: f[idx("note_text")] ?? "",
      outcome: f[idx("outcome")] ?? "",
      result: f[idx("result")] ?? "",
      judge_guidance: f[idx("judge_guidance")] ?? "",
    });
  }
  return { name: path.basename(folder), rows };
}

const PASS_RESULTS = new Set(["correct", "rejected"]);
const FP_RESULTS = new Set(["incorrect_rejection", "false_positive"]); // tighten if labels differ

function isPass(r: RunRow): boolean {
  // "correct" labels in evaluateResults.CATEGORY_RESULT_LABEL map both
  // note_worthy_correct AND non_note_worthy_correct to "correct".
  return r.result === "correct";
}

function isFalsePositive(r: RunRow): boolean {
  // non_note_worthy_incorrect — a note was proposed on a needs_note=no tweet.
  return r.needs_note === "no" && r.note_text.trim().length > 0;
}

function fmt(row: RunRow): string {
  const note = row.note_text.replace(/\s+/g, " ").trim().slice(0, 200);
  return `outcome=${row.outcome.slice(0, 80)} | note="${note}"`;
}

function main(): void {
  const [baseFolder, newFolder] = process.argv.slice(2);
  if (!baseFolder || !newFolder) {
    console.error("Usage: bun run diff_runs.ts <base_run_folder> <new_run_folder>");
    process.exit(1);
  }
  const base = loadRun(baseFolder);
  const next = loadRun(newFolder);

  const urls = new Set([...base.rows.keys(), ...next.rows.keys()]);
  const lines: string[] = [`# diff: ${next.name} vs ${base.name}\n`];

  let basePass = 0, nextPass = 0, baseFp = 0, nextFp = 0, common = 0;
  const regressions: { url: string; base: RunRow; next: RunRow }[] = [];
  const wins: { url: string; base: RunRow; next: RunRow }[] = [];

  for (const url of urls) {
    const b = base.rows.get(url);
    const n = next.rows.get(url);
    if (b) basePass += isPass(b) ? 1 : 0;
    if (n) nextPass += isPass(n) ? 1 : 0;
    if (b) baseFp += isFalsePositive(b) ? 1 : 0;
    if (n) nextFp += isFalsePositive(n) ? 1 : 0;
    if (b && n) {
      common++;
      if (isPass(b) && !isPass(n)) regressions.push({ url, base: b, next: n });
      if (!isPass(b) && isPass(n)) wins.push({ url, base: b, next: n });
    }
  }

  lines.push("## Aggregate\n");
  lines.push(`- PASS: ${basePass} → ${nextPass} (Δ ${signed(nextPass - basePass)})`);
  lines.push(`- False positives: ${baseFp} → ${nextFp} (Δ ${signed(nextFp - baseFp)})`);
  lines.push(`- Common rows: ${common}`);
  lines.push(`- Regressions: ${regressions.length}`);
  lines.push(`- Wins: ${wins.length}\n`);

  if (regressions.length) {
    lines.push(`## Regressions (correct → incorrect, ${regressions.length} rows)\n`);
    for (const r of regressions) {
      lines.push(`### ${r.url} (needs_note=${r.base.needs_note})`);
      lines.push(`- **${base.name}:** ${fmt(r.base)}`);
      lines.push(`- **${next.name}:** ${fmt(r.next)}`);
      if (r.base.judge_guidance) {
        lines.push(`- guidance: ${r.base.judge_guidance.slice(0, 240)}${r.base.judge_guidance.length > 240 ? "…" : ""}`);
      }
      lines.push("");
    }
  }

  if (wins.length) {
    lines.push(`## Wins (incorrect → correct, ${wins.length} rows)\n`);
    for (const w of wins) {
      lines.push(`### ${w.url} (needs_note=${w.base.needs_note})`);
      lines.push(`- **${base.name}:** ${fmt(w.base)}`);
      lines.push(`- **${next.name}:** ${fmt(w.next)}`);
      lines.push("");
    }
  }

  const out = path.join(newFolder, `diff_vs_${base.name}.md`);
  fs.writeFileSync(out, lines.join("\n"));
  console.log(lines.join("\n"));
  console.log(`\nWritten to: ${out}`);
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

main();
