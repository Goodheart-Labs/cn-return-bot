/**
 * Replay iter-4's cached writer inputs through the new M2+M3 writer prompt.
 *
 * Goal: validate that the M2 claim-mapping preamble + M3 relaxed empty rule
 * produces better notes than the iter-4 writer on the SAME inputs (post +
 * findings), BEFORE running a full val.csv pass.
 *
 * For each iter-4 row where the writer was actually invoked:
 *   - Parse the cached writer userMessage to recover postContext + findings.
 *   - Run the new writer (DeepSeek v4 Flash, low reasoning — matching iter-4).
 *   - Have Sonnet (claude-sonnet-4.6) judge each new note against
 *     judge_guidance + ground_truth_note + failure_reason (reusing the same
 *     judgeRow logic the local pipeline runner uses).
 *   - Compare to iter-4's outcome (`result` column).
 *
 * Cost: ~63 deepseek calls (~$0.05) + ~63 sonnet judges (~$2-3). Worth it
 * before burning Brave credits on a full val run.
 *
 * Run:
 *   bun src/scripts_jim/2026_05_28_writer_iter4/replay_writer_iter4.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords } from "../../utils/csv";
import { runWriter } from "../../pipeline/simple-bot/writer";
import { judgeRow, type CsvRow, type JudgeVerdict } from "../../local/evaluateResults";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";

const ITER4_CSV =
  "dataset_runs/tryout-iter-04-cheap-bot-merged/results_iter-04-cheap-bot.csv";
const OUT_DIR = "src/scripts_jim/2026_05_28_writer_iter4";

interface ReplayRow {
  url: string;
  needsNote: string;
  iter4Note: string;
  iter4Result: string; // CSV `result` column from iter-4 categorization
  newNote: string;
  newSources: string[];
  newClaimsAnalysis: any[];
  newVerdict: JudgeVerdict | null;
  classification: string;
}

function splitWriterUserMessage(userMessage: string): { postContext: string; findings: string } {
  const FINDINGS_HDR = "## Research findings";
  const idx = userMessage.indexOf(FINDINGS_HDR);
  if (idx < 0) return { postContext: userMessage.trim(), findings: "" };
  return {
    postContext: userMessage.slice(0, idx).trim(),
    findings: userMessage.slice(idx).trim(),
  };
}

/** Classify a single row's outcome:
 *  - needs=yes + new_correct=true  → NW_NEW_CORRECT (good)
 *  - needs=yes + new_correct=false → NW_NEW_INCORRECT (bad note OR didn't write)
 *  - needs=no  + new_empty         → NNW_CORRECT_ABSTAIN (good)
 *  - needs=no  + new_wrote         → NNW_FP (bad)
 *
 *  Plus a delta tag vs iter-4: WIN / LOSS / MATCH. */
function classifyRow(args: {
  needsNote: string;
  iter4Result: string;
  newNoteEmpty: boolean;
  newVerdictCorrect: boolean | null;
}): string {
  const truth = args.needsNote.toLowerCase();
  // What did iter-4 do?
  const iter4Correct =
    args.iter4Result === "correct" || args.iter4Result === "correct rejection";
  const iter4WroteNote = args.iter4Result === "correct" || args.iter4Result === "incorrect" || args.iter4Result === "false positive";

  // What did new do?
  let newCorrect: boolean;
  if (truth === "yes") {
    newCorrect = !args.newNoteEmpty && args.newVerdictCorrect === true;
  } else {
    // needs=no: new is correct iff it abstained
    newCorrect = args.newNoteEmpty;
  }

  if (iter4Correct === newCorrect) return iter4Correct ? "BOTH_CORRECT" : "BOTH_WRONG";
  if (newCorrect && !iter4Correct) {
    if (truth === "yes" && !iter4WroteNote) return "WIN_RECOVERED_MISS";
    if (truth === "yes" && iter4WroteNote) return "WIN_FIXED_BAD_NOTE";
    return "WIN_FIXED_FP";
  }
  // iter4 correct, new wrong → regression
  if (truth === "yes") return args.newNoteEmpty ? "LOSS_NOW_EMPTY" : "LOSS_NOW_BAD_NOTE";
  return "LOSS_NEW_FP";
}

async function main(): Promise<void> {
  const content = fs.readFileSync(ITER4_CSV, "utf8").trim();
  const records = parseCsvRecords(content);
  const headers = records[0]!.map((h) => h.trim());
  const rows = records.slice(1).map((fields) => {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => (r[h] = fields[i] ?? ""));
    return r;
  });
  console.log(`[setup] loaded ${rows.length} iter-4 rows`);

  // Collect rows where writer had input (findings non-empty in cached message).
  // M3 says writer should now write a note in some rows where iter-4 returned
  // empty, so we INCLUDE rows where iter-4's writer abstained — as long as we
  // have a writer userMessage cached.
  const targets: Array<{
    url: string;
    needsNote: string;
    iter4Note: string;
    iter4Result: string;
    iter4Sources: string[];
    postContext: string;
    findings: string;
    row: Record<string, string>;
  }> = [];

  for (const row of rows) {
    if (!row.logs) continue;
    let logs: any;
    try { logs = JSON.parse(row.logs); } catch { continue; }
    const attempt0 = logs?.simpleBot?.writer?.attempts?.[0]
      ?? logs?.simpleBot?.writer?.attempts?.["0"];
    const writerMsgs = attempt0?.messages ?? [];
    const writerUserMsg = writerMsgs[1]?.content ?? "";
    if (!writerUserMsg) continue;

    const { postContext, findings } = splitWriterUserMessage(writerUserMsg);
    // Skip rows where findings are completely empty — those are search blackouts,
    // not writer test targets.
    if (!findings || findings.length < 50) continue;

    const writerResp = attempt0?.response;
    const iter4Note = String(writerResp?.note_text ?? "");
    const iter4Sources: string[] = Array.isArray(writerResp?.sources) ? writerResp.sources : [];

    targets.push({
      url: row.url ?? "",
      needsNote: (row.needs_note ?? "").toLowerCase(),
      iter4Note,
      iter4Result: row.result ?? "",
      iter4Sources,
      postContext,
      findings,
      row,
    });
  }
  console.log(`[setup] ${targets.length} rows have writer-replayable inputs`);

  const cheapBotConfig: BotConfig = {
    ...DEFAULT_CONFIG,
    botId: "cheap-bot",
    model: "deepseek/deepseek-v4-flash",
    reasoning_effort: "low",
  };

  const results: ReplayRow[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    let newNote = "";
    let newSources: string[] = [];
    let newClaimsAnalysis: any[] = [];
    let newVerdict: JudgeVerdict | null = null;
    let errMsg = "";

    try {
      const out = await withBotConfig(cheapBotConfig, async () => {
        return await runWriter(t.postContext, t.findings);
      });
      newNote = out.noteText;
      newSources = out.sources;
      // claims_analysis isn't on WriterResult; the writer logs it but we'd need
      // to thread it out. For the replay summary, the verdict is what matters —
      // claims_analysis is visible in the per-row JSON output if we want to
      // inspect failures later.
      newClaimsAnalysis = [];
    } catch (err: any) {
      errMsg = err?.message ?? "unknown error";
    }

    // Sonnet judge on the new note. Skip when new note is empty + truth=yes
    // (judge would just confirm "no note proposed"); we treat that as "incorrect"
    // outright. When new is empty + truth=no, abstain is correct — skip judge.
    if (newNote && newNote.trim().length > 0) {
      const judgeInput: CsvRow = {
        text: t.row.text ?? "",
        ground_truth_note: t.row.ground_truth_note ?? "",
        judge_guidance: t.row.judge_guidance ?? "",
        original_note_text: t.row.original_note_text ?? "",
        failure_reason: t.row.failure_reason ?? "",
        note_text: newNote,
      };
      try {
        newVerdict = await judgeRow(judgeInput);
      } catch (err: any) {
        errMsg = `judge: ${err?.message ?? "unknown"}`;
      }
    }

    const classification = classifyRow({
      needsNote: t.needsNote,
      iter4Result: t.iter4Result,
      newNoteEmpty: !newNote.trim(),
      newVerdictCorrect: newNote.trim() ? (newVerdict !== null && newVerdict.tier !== "bad") : null,
    });

    results.push({
      url: t.url,
      needsNote: t.needsNote,
      iter4Note: t.iter4Note,
      iter4Result: t.iter4Result,
      newNote,
      newSources,
      newClaimsAnalysis,
      newVerdict,
      classification,
    });

    const idShort = t.url.replace(/^.*status\//, "");
    const wroteOld = t.iter4Note.trim() ? "wrote" : "empty";
    const wroteNew = newNote.trim() ? "wrote" : "empty";
    const verdict = newVerdict ? (newVerdict.tier !== "bad" ? "✓" : "✗") : "-";
    console.log(
      `[${(i + 1).toString().padStart(3)}/${targets.length}] needs=${t.needsNote.padEnd(3)} ${idShort.padEnd(20)} iter4=${wroteOld}(${t.iter4Result}) new=${wroteNew}(${verdict}) → ${classification}${errMsg ? " ERR:" + errMsg : ""}`,
    );
  }

  // Summary
  const bucket: Record<string, number> = {};
  for (const r of results) bucket[r.classification] = (bucket[r.classification] ?? 0) + 1;
  console.log("\n=== Classification counts ===");
  for (const [k, v] of Object.entries(bucket).sort()) console.log(`  ${k.padEnd(28)} ${v}`);

  const wins = results.filter((r) => r.classification.startsWith("WIN")).length;
  const losses = results.filter((r) => r.classification.startsWith("LOSS")).length;
  console.log(`\nNet writer-stage delta: ${wins} wins − ${losses} losses = ${wins - losses}`);

  fs.writeFileSync(path.join(OUT_DIR, "replay_results.json"), JSON.stringify(results, null, 2));
  console.log(`\nFull results → ${path.join(OUT_DIR, "replay_results.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
