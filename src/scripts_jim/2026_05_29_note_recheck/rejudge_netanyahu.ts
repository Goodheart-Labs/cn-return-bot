/**
 * Diagnose why the eval tier judge (judgeRow) rated the Netanyahu note "bad"
 * even though it meets every stated PASS criterion. Re-runs judgeRow N times
 * on the exact row + writer note from the iter-07 run and prints tier + reason.
 */
import "dotenv/config";
import * as fs from "fs";
import { parseCsvRecords } from "../../utils/csv";
import { judgeRow, type CsvRow } from "../../local/evaluateResults";

const CSV = "dataset_runs/tryout-iter-07-judge-temp0-2026-05-28-2250/results_iter-07-judge-temp0.csv";
const TID = "2033436730251264262";
const RUNS = 5;

function loadRow(): { row: CsvRow; sources: string[] } {
  const recs = parseCsvRecords(fs.readFileSync(CSV, "utf8").trim());
  const headers = recs[0]!.map((h) => h.trim());
  for (const fields of recs.slice(1)) {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => (r[h] = fields[i] ?? ""));
    if ((r.url ?? "").endsWith(TID)) {
      const logs = JSON.parse(r.logs || "{}");
      const a0 = logs?.simpleBot?.writer?.attempts?.["0"] ?? logs?.simpleBot?.writer?.attempts?.[0];
      const note = String(a0?.response?.note_text ?? "");
      const sources: string[] = Array.isArray(a0?.response?.sources) ? a0.response.sources : [];
      return {
        row: {
          text: r.tweet_text ?? r.text ?? "",
          ground_truth_note: r.ground_truth_note ?? "",
          judge_guidance: r.judge_guidance ?? "",
          original_note_text: r.original_note_text ?? "",
          failure_reason: r.failure_reason ?? "",
          note_text: note,
        },
        sources,
      };
    }
  }
  throw new Error("row not found");
}

async function main() {
  const { row, sources } = loadRow();
  console.log("note_text:", row.note_text);
  console.log("sources:", sources, "\n");
  for (let i = 0; i < RUNS; i++) {
    const v = await judgeRow(row, sources);
    console.log(`run ${i + 1}: tier=${v.tier}  reason=${v.reason ?? ""}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
