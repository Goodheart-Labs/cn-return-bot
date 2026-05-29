/**
 * Replay the iter-2 cached judge inputs through the NEW judge prompt
 * (src/pipeline/simple-bot/judge.ts) to see how many false positives flip.
 *
 * Reads dataset_runs/tryout-iter-02-cheap-bot-2026-05-27-1045/results_iter-02-cheap-bot.csv
 * Each row's `logs` field contains simpleBot.judge.messages[0].userMessage —
 * the exact prompt the judge originally saw. We re-run it with the new
 * SYSTEM_PROMPT + fewshots and compare to the iter-2 decision.
 *
 * Reports flip rates per category:
 *   - FPs (non_note_worthy_incorrect): want to flip TRUE → FALSE
 *   - Correct positives (note_worthy_correct + verifier-killed misses):
 *       want to stay TRUE → TRUE
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_27_judge_iter3/replay_judge.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords } from "../../utils/csv";
import { llm } from "../../pipeline/llm/llm";

// Re-import the same SYSTEM_PROMPT + FEWSHOTS by importing the judge module.
// The judge expects a tweet log + cost tracker context. To avoid pulling
// those, we duplicate the message-building logic here at module load by
// reading the constants out of judge.ts via dynamic import.

const ITER2_CSV =
  "dataset_runs/tryout-iter-02-cheap-bot-2026-05-27-1045/results_iter-02-cheap-bot.csv";
const OUT_DIR = "src/scripts_jim/2026_05_27_judge_iter3";

import { buildJudgeMessages, JUDGE_RESPONSE_FORMAT } from "../../pipeline/simple-bot/judge";

interface RowResult {
  url: string;
  category: string;
  needsNote: string;
  iter2Decision: boolean | null;
  iter2Reasoning: string;
  newDecision: boolean | null;
  newReasoning: string;
  flipped: "FP_FIXED" | "TP_KEPT" | "TP_LOST" | "FP_KEPT" | "UNKNOWN";
}

async function main(): Promise<void> {

  // Load iter-2 results
  const content = fs.readFileSync(ITER2_CSV, "utf8").trim();
  const records = parseCsvRecords(content);
  const headers = records[0]!.map((h) => h.trim());
  const rows = records.slice(1).map((fields) => {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => (r[h] = fields[i] ?? ""));
    return r;
  });
  console.log(`[setup] loaded ${rows.length} iter-2 rows`);

  // For each row where the judge ran (i.e., a note was written), extract the
  // cached user message and the iter-2 decision.
  const judgeRuns: Array<{
    url: string;
    iter2Decision: boolean;
    iter2Reasoning: string;
    userMessage: string;
    truthNeedsNote: string;
    proposed: boolean; // did the note actually leave the judge as proposed?
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
    const decisionContent = msg1.content;
    if (!userMessage || !decisionContent) continue;

    // decisionContent may be already-parsed JSON or stringified
    let parsed: any = decisionContent;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        continue;
      }
    }
    judgeRuns.push({
      url: row.url ?? "",
      iter2Decision: !!parsed.note_needed,
      iter2Reasoning: String(parsed.reasoning ?? ""),
      userMessage,
      truthNeedsNote: (row.needs_note ?? "").toLowerCase(),
      proposed: (row.outcome ?? "") === "ok",
    });
  }

  console.log(`[setup] ${judgeRuns.length} judge invocations recorded`);
  // Classify by category for reporting
  const fpUrls = new Set(
    JSON.parse(
      fs.readFileSync(
        "dataset_runs/tryout-iter-02-cheap-bot-2026-05-27-1045/_failure_batches/non_note_worthy_incorrect.json",
        "utf8",
      ),
    ).map((r: any) => r.url),
  );
  const correctUrls = new Set(
    (
      JSON.parse(
        fs.readFileSync(
          "dataset_runs/tryout-iter-02-cheap-bot-2026-05-27-1045/note_worthy_correct.json",
          "utf8",
        ),
      ) as any[]
    ).map((r) => r.url),
  );
  const missedUrls = new Set(
    JSON.parse(
      fs.readFileSync(
        "dataset_runs/tryout-iter-02-cheap-bot-2026-05-27-1045/_failure_batches/note_worthy_not_proposed.json",
        "utf8",
      ),
    ).map((r: any) => r.url),
  );
  // "Verifier-killed misses" = judge said YES but final result wasn't proposed
  // (handled below via iter2Decision + the truth label).

  const targetRuns = judgeRuns.filter(
    (r) => fpUrls.has(r.url) || correctUrls.has(r.url) || missedUrls.has(r.url),
  );
  console.log(`[setup] ${targetRuns.length} target rows to replay`);

  const results: RowResult[] = [];
  const model = "deepseek/deepseek-v4-flash";
  for (let i = 0; i < targetRuns.length; i++) {
    const run = targetRuns[i]!;
    let cat = "unknown";
    if (fpUrls.has(run.url)) cat = "FP";
    else if (correctUrls.has(run.url)) cat = "CORRECT";
    else if (missedUrls.has(run.url)) cat = "MISSED";

    try {
      const response = await (llm as any).create({
        model,
        messages: buildJudgeMessages(run.userMessage),
        response_format: JUDGE_RESPONSE_FORMAT,
      });
      const content = response.choices?.[0]?.message?.content ?? "";
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        results.push({
          url: run.url,
          category: cat,
          needsNote: run.truthNeedsNote,
          iter2Decision: run.iter2Decision,
          iter2Reasoning: run.iter2Reasoning,
          newDecision: null,
          newReasoning: `PARSE_ERR: ${content.slice(0, 100)}`,
          flipped: "UNKNOWN",
        });
        continue;
      }
      const newDecision = !!parsed.note_needed;
      const newReasoning = String(parsed.reasoning ?? "");
      let flipped: RowResult["flipped"] = "UNKNOWN";
      if (cat === "FP") {
        flipped = newDecision ? "FP_KEPT" : "FP_FIXED";
      } else if (cat === "CORRECT") {
        flipped = newDecision ? "TP_KEPT" : "TP_LOST";
      } else if (cat === "MISSED") {
        // Missed = truth was 'yes' but iter-2 didn't propose. If iter-2 judge
        // said TRUE (and verifier killed it), we want to keep saying TRUE.
        if (run.iter2Decision) {
          flipped = newDecision ? "TP_KEPT" : "TP_LOST";
        } else {
          // iter-2 judge already rejected — new judge agreeing is neutral.
          flipped = newDecision ? "TP_KEPT" : "FP_KEPT";
        }
      }
      results.push({
        url: run.url,
        category: cat,
        needsNote: run.truthNeedsNote,
        iter2Decision: run.iter2Decision,
        iter2Reasoning: run.iter2Reasoning,
        newDecision,
        newReasoning,
        flipped,
      });
      const arrow = newDecision === run.iter2Decision ? "==" : "→→";
      console.log(
        `[${i + 1}/${targetRuns.length}] ${cat} ${run.url}: ${run.iter2Decision ? "T" : "F"} ${arrow} ${newDecision ? "T" : "F"} (${flipped})`,
      );
    } catch (err: any) {
      console.error(`[${i + 1}] ERROR on ${run.url}: ${err?.message}`);
      results.push({
        url: run.url,
        category: cat,
        needsNote: run.truthNeedsNote,
        iter2Decision: run.iter2Decision,
        iter2Reasoning: run.iter2Reasoning,
        newDecision: null,
        newReasoning: `ERR: ${err?.message}`,
        flipped: "UNKNOWN",
      });
    }
  }

  // Summary
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.flipped] = (counts[r.flipped] ?? 0) + 1;

  console.log("\n=== Summary ===");
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v} ${k}`);
  }

  const fps = results.filter((r) => r.category === "FP");
  const corr = results.filter((r) => r.category === "CORRECT");
  const missed = results.filter((r) => r.category === "MISSED");
  const missedJudgeYes = missed.filter((r) => r.iter2Decision);
  const missedJudgeNo = missed.filter((r) => !r.iter2Decision);

  console.log(
    `\nFPs (${fps.length}): fixed=${fps.filter((r) => r.flipped === "FP_FIXED").length}, kept=${fps.filter((r) => r.flipped === "FP_KEPT").length}`,
  );
  console.log(
    `Correct (${corr.length}): kept=${corr.filter((r) => r.flipped === "TP_KEPT").length}, lost=${corr.filter((r) => r.flipped === "TP_LOST").length}`,
  );
  console.log(
    `Missed-judge-said-YES (${missedJudgeYes.length}): kept=${missedJudgeYes.filter((r) => r.flipped === "TP_KEPT").length}, lost=${missedJudgeYes.filter((r) => r.flipped === "TP_LOST").length}`,
  );
  console.log(
    `Missed-judge-said-NO (${missedJudgeNo.length}): now-says-yes=${missedJudgeNo.filter((r) => r.newDecision).length}, still-no=${missedJudgeNo.filter((r) => !r.newDecision).length}`,
  );

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "replay_results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`\nFull results: ${path.join(OUT_DIR, "replay_results.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
