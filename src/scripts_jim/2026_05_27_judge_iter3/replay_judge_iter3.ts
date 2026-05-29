/**
 * Replay iter-3's cached judge inputs through the NEW judge prompt
 * (4-step claim-extraction pipeline). Compare verdicts to iter-3's.
 *
 * Goal: validate that the new judge prompt is at least as good as the iter-3
 * judge on the same set of inputs BEFORE spending money on a full val.csv run.
 *
 * The script:
 *   1. reads iter-3's merged CSV
 *   2. for each row with logs.simpleBot.judge present, replays the cached
 *      userMessage through the new judge (current code on disk)
 *   3. classifies each row as FP / CORRECT / MISSED based on iter-3 outcome
 *   4. compares iter-3's decision to the new one and reports flips
 *
 * Run:
 *   bun src/scripts_jim/2026_05_27_judge_iter3/replay_judge_iter3.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords } from "../../utils/csv";
import { llm } from "../../pipeline/llm/llm";
import { buildJudgeMessages, JUDGE_RESPONSE_FORMAT } from "../../pipeline/simple-bot/judge";

const ITER3_CSV =
  "dataset_runs/tryout-iter-03-cheap-bot-merged/results_iter-03-cheap-bot.csv";
const OUT_DIR = "src/scripts_jim/2026_05_27_judge_iter3";
const REASONING_EFFORT: "low" | undefined = "low"; // match cheap-bot config

interface RowResult {
  url: string;
  category: "FP" | "CORRECT" | "MISSED" | "OTHER";
  needsNote: string;
  iter3Decision: boolean;
  iter3Reasoning: string;
  newDecision: boolean | null;
  newReasoning: string;
  flipped: "FP_FIXED" | "FP_KEPT" | "TP_KEPT" | "TP_LOST" | "M_NOW_YES" | "M_STILL_NO" | "UNKNOWN";
}

async function main(): Promise<void> {
  const content = fs.readFileSync(ITER3_CSV, "utf8").trim();
  const records = parseCsvRecords(content);
  const headers = records[0]!.map((h) => h.trim());
  const rows = records.slice(1).map((fields) => {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => (r[h] = fields[i] ?? ""));
    return r;
  });
  console.log(`[setup] loaded ${rows.length} iter-3 rows`);

  // Per-row category from `result` column (cheap_bot scored inline)
  function categoryFor(needsNote: string, result: string): RowResult["category"] {
    const nn = needsNote.toLowerCase();
    if (nn === "no") {
      if (result === "false positive" || result === "incorrect") return "FP";
      return "OTHER";
    }
    if (nn === "yes") {
      if (result === "correct" || result === "incorrect") return "CORRECT";
      if (result === "missed") return "MISSED";
    }
    return "OTHER";
  }

  const judgeRuns: Array<{
    url: string;
    category: RowResult["category"];
    needsNote: string;
    iter3Decision: boolean;
    iter3Reasoning: string;
    userMessage: string;
  }> = [];

  for (const row of rows) {
    if (!row.logs) continue;
    let logs: any;
    try {
      logs = JSON.parse(row.logs);
    } catch {
      continue;
    }
    const msg0 = logs?.simpleBot?.judge?.messages?.["0"];
    const msg1 = logs?.simpleBot?.judge?.messages?.["1"];
    if (!msg0 || !msg1) continue;
    const userMessage = msg0.userMessage;
    let decision: any = msg1.content;
    if (typeof decision === "string") {
      try {
        decision = JSON.parse(decision);
      } catch {
        continue;
      }
    }
    if (!userMessage || decision == null) continue;
    judgeRuns.push({
      url: row.url ?? "",
      category: categoryFor(row.needs_note ?? "", row.result ?? ""),
      needsNote: (row.needs_note ?? "").toLowerCase(),
      iter3Decision: !!decision.note_needed,
      iter3Reasoning: String(decision.reasoning ?? ""),
      userMessage,
    });
  }
  console.log(`[setup] ${judgeRuns.length} cached judge invocations available`);

  const targetRuns = judgeRuns.filter((r) => r.category !== "OTHER");
  console.log(`[setup] ${targetRuns.length} target rows after dropping OTHER`);

  const results: RowResult[] = [];
  const model = "deepseek/deepseek-v4-flash";
  for (let i = 0; i < targetRuns.length; i++) {
    const run = targetRuns[i]!;
    try {
      const response = await (llm as any).create({
        model,
        messages: buildJudgeMessages(run.userMessage),
        response_format: JUDGE_RESPONSE_FORMAT,
        ...(REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT } : {}),
      });
      const content = response.choices?.[0]?.message?.content ?? "";
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        results.push({
          url: run.url,
          category: run.category,
          needsNote: run.needsNote,
          iter3Decision: run.iter3Decision,
          iter3Reasoning: run.iter3Reasoning,
          newDecision: null,
          newReasoning: `PARSE_ERR: ${content.slice(0, 200)}`,
          flipped: "UNKNOWN",
        });
        continue;
      }
      const newDecision = !!parsed.note_needed;
      const newReasoning = String(parsed.reasoning ?? "");
      let flipped: RowResult["flipped"] = "UNKNOWN";
      if (run.category === "FP") {
        flipped = newDecision ? "FP_KEPT" : "FP_FIXED";
      } else if (run.category === "CORRECT") {
        flipped = newDecision ? "TP_KEPT" : "TP_LOST";
      } else if (run.category === "MISSED") {
        flipped = newDecision
          ? (run.iter3Decision ? "TP_KEPT" : "M_NOW_YES")
          : (run.iter3Decision ? "TP_LOST" : "M_STILL_NO");
      }
      results.push({
        url: run.url,
        category: run.category,
        needsNote: run.needsNote,
        iter3Decision: run.iter3Decision,
        iter3Reasoning: run.iter3Reasoning,
        newDecision,
        newReasoning,
        flipped,
      });
      const arrow = newDecision === run.iter3Decision ? "==" : "→→";
      const idShort = run.url.replace(/^.*status\//, "");
      console.log(
        `[${(i + 1).toString().padStart(3)}/${targetRuns.length}] ${run.category.padEnd(7)} ${idShort.padEnd(20)} ${run.iter3Decision ? "T" : "F"} ${arrow} ${newDecision ? "T" : "F"}  (${flipped})`,
      );
    } catch (err: any) {
      console.error(`[${i + 1}] ERROR on ${run.url}: ${err?.message}`);
      results.push({
        url: run.url,
        category: run.category,
        needsNote: run.needsNote,
        iter3Decision: run.iter3Decision,
        iter3Reasoning: run.iter3Reasoning,
        newDecision: null,
        newReasoning: `ERR: ${err?.message}`,
        flipped: "UNKNOWN",
      });
    }
  }

  // Summary
  const flips: Record<string, number> = {};
  for (const r of results) flips[r.flipped] = (flips[r.flipped] ?? 0) + 1;

  const fps = results.filter((r) => r.category === "FP");
  const corr = results.filter((r) => r.category === "CORRECT");
  const missed = results.filter((r) => r.category === "MISSED");
  const missedJudgeYes = missed.filter((r) => r.iter3Decision);
  const missedJudgeNo = missed.filter((r) => !r.iter3Decision);

  console.log("\n=== Summary ===");
  console.log(`FPs (${fps.length}):`);
  console.log(`  fixed (T→F):  ${fps.filter((r) => r.flipped === "FP_FIXED").length}`);
  console.log(`  kept  (T→T):  ${fps.filter((r) => r.flipped === "FP_KEPT").length}`);
  console.log(`CORRECT (${corr.length}):`);
  console.log(`  kept  (T→T):  ${corr.filter((r) => r.flipped === "TP_KEPT").length}`);
  console.log(`  lost  (T→F):  ${corr.filter((r) => r.flipped === "TP_LOST").length}  ← regressions`);
  console.log(`MISSED — iter-3 judge said YES (${missedJudgeYes.length}, killed downstream):`);
  console.log(`  still YES:    ${missedJudgeYes.filter((r) => r.flipped === "TP_KEPT").length}`);
  console.log(`  now NO:       ${missedJudgeYes.filter((r) => r.flipped === "TP_LOST").length}`);
  console.log(`MISSED — iter-3 judge said NO (${missedJudgeNo.length}, judge rejected):`);
  console.log(`  now YES:      ${missedJudgeNo.filter((r) => r.flipped === "M_NOW_YES").length}  ← unblocks misses`);
  console.log(`  still NO:     ${missedJudgeNo.filter((r) => r.flipped === "M_STILL_NO").length}`);
  const parseErrs = results.filter((r) => r.flipped === "UNKNOWN").length;
  if (parseErrs) console.log(`PARSE/ERR rows: ${parseErrs}`);

  // Net-impact projection if we adopted the new judge as-is
  const fpFixed = flips["FP_FIXED"] ?? 0;
  const tpLost = flips["TP_LOST"] ?? 0;
  const missesUnblocked = flips["M_NOW_YES"] ?? 0;
  const netPassDelta = fpFixed - tpLost + missesUnblocked;
  console.log(`\n=== Predicted iter-4 val deltas (judge-only effect) ===`);
  console.log(`  FPs:     ${fps.length} → ${fps.length - fpFixed}  (${-fpFixed} ≤ 0 good)`);
  console.log(`  Lost CORRECTs: ${tpLost}`);
  console.log(`  Unblocked MISSED: ${missesUnblocked}  (downstream verifier/writer may still kill some)`);
  console.log(`  Net PASS delta (upper bound): +${netPassDelta}`);

  fs.writeFileSync(
    path.join(OUT_DIR, "replay_results_iter3.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`\nFull results → ${path.join(OUT_DIR, "replay_results_iter3.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
