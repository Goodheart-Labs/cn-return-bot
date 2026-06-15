/**
 * Replay iter-4's cached writer outputs through the new M1 2-call judge.
 *
 * Goal: validate that the M1 decomposition (claim extraction → per-claim
 * judgment, with ANY-claim-passes verdict logic) is at least as good as the
 * single-call 4-step judge BEFORE running a full val.csv pass.
 *
 * For each iter-4 row where the writer produced a non-empty note (judge was
 * actually invoked):
 *   - Parse the cached writer userMessage to recover postContext + findings.
 *   - Pull the writer's response (note_text + sources).
 *   - Run the new 2-call judge.
 *   - Compare verdict to ground truth (CSV `needs_note` column).
 *   - Cross-tab against iter-4's own judge verdict to surface flips.
 *
 * Run:
 *   bun src/scripts_jim/2026_05_28_judge_iter4/replay_judge_iter4.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords } from "../../utils/csv";
import { extractClaims, judgeClaimsWithNote } from "../../pipeline/simple-bot/judge";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";

const ITER4_CSV =
  "dataset_runs/tryout-iter-04-cheap-bot-merged/results_iter-04-cheap-bot.csv";
const OUT_DIR = "src/scripts_jim/2026_05_28_judge_iter4";

interface ReplayRow {
  url: string;
  needsNote: "yes" | "no" | "unknown";
  iter4Verdict: boolean | null; // null = judge wasn't invoked / not parseable
  newVerdict: boolean | null; // null = error
  newReasoning: string;
  claimsExtracted: number;
  noCheckableClaims: boolean;
  classification:
    | "TP_KEPT"
    | "TP_LOST"
    | "FP_KEPT"
    | "FP_FIXED"
    | "FP_REGRESSION"
    | "MISS_UNBLOCKED"
    | "MISS_STILL_BLOCKED"
    | "TP_FOUND" // iter-4 rejected, new accepts → may be win or new FP
    | "UNKNOWN";
}

/** Split the writer's userMessage into the postContext block (before findings)
 *  and the research findings block. The writer prompt assembles these via
 *  buildUserMessage; findings always come after a "## Research findings"
 *  header in the resulting string. */
function splitWriterUserMessage(userMessage: string): { postContext: string; findings: string } {
  const FINDINGS_HDR = "## Research findings";
  const idx = userMessage.indexOf(FINDINGS_HDR);
  if (idx < 0) return { postContext: userMessage.trim(), findings: "" };
  return {
    postContext: userMessage.slice(0, idx).trim(),
    findings: userMessage.slice(idx).trim(),
  };
}

function classify(needsNote: string, iter4: boolean | null, neu: boolean | null): ReplayRow["classification"] {
  if (neu === null) return "UNKNOWN";
  const truth = needsNote === "yes";
  if (truth && neu) return iter4 === true ? "TP_KEPT" : "MISS_UNBLOCKED";
  if (truth && !neu) return iter4 === true ? "TP_LOST" : "MISS_STILL_BLOCKED";
  if (!truth && neu) return iter4 === true ? "FP_KEPT" : "FP_REGRESSION";
  // !truth && !neu
  return iter4 === true ? "FP_FIXED" : "TP_KEPT" /* iter-4 also said no — correctly rejected */;
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

  // Filter to rows where writer produced a non-empty note (judge was called).
  const judgeable: Array<{
    url: string;
    needsNote: string;
    postContext: string;
    findings: string;
    noteText: string;
    sources: string[];
    iter4Verdict: boolean | null;
  }> = [];

  for (const row of rows) {
    if (!row.logs) continue;
    let logs: any;
    try { logs = JSON.parse(row.logs); } catch { continue; }
    const attempt0 = logs?.simpleBot?.writer?.attempts?.[0]
      ?? logs?.simpleBot?.writer?.attempts?.["0"];
    const writerMsgs = attempt0?.messages ?? [];
    const writerUserMsg = writerMsgs[1]?.content ?? "";
    const writerResp = attempt0?.response;
    if (!writerUserMsg || !writerResp) continue;
    const noteText = String(writerResp.note_text ?? "");
    if (!noteText.trim()) continue; // writer returned empty → judge wasn't called

    const { postContext, findings } = splitWriterUserMessage(writerUserMsg);
    const sources: string[] = Array.isArray(writerResp.sources) ? writerResp.sources : [];

    // iter-4's judge verdict (from the old single-call format).
    let iter4Verdict: boolean | null = null;
    const judgeMsg1 = logs?.simpleBot?.judge?.messages?.[1] ?? logs?.simpleBot?.judge?.messages?.["1"];
    if (judgeMsg1?.content) {
      let dec: any = judgeMsg1.content;
      if (typeof dec === "string") { try { dec = JSON.parse(dec); } catch {} }
      if (dec && typeof dec === "object" && "note_needed" in dec) iter4Verdict = !!dec.note_needed;
    }

    judgeable.push({
      url: row.url ?? "",
      needsNote: (row.needs_note ?? "").toLowerCase(),
      postContext,
      findings,
      noteText,
      sources,
      iter4Verdict,
    });
  }
  console.log(`[setup] ${judgeable.length} rows had a non-empty writer note (judge replayable)`);

  // Run inside a bot-config scope so judge.ts can read model + reasoning_effort.
  // Match iter-4's cheap-bot variant config (deepseek-v4-flash, low reasoning).
  const cheapBotConfig: BotConfig = {
    ...DEFAULT_CONFIG,
    botId: "cheap-bot",
    model: "deepseek/deepseek-v4-flash",
    reasoning_effort: "low",
    note_needed_judge: true,
  };

  const results: ReplayRow[] = [];
  for (let i = 0; i < judgeable.length; i++) {
    const r = judgeable[i]!;
    let newVerdict: boolean | null = null;
    let newReasoning = "";
    let claimsExtracted = 0;
    let noCheckable = false;
    try {
      const out = await withBotConfig(cheapBotConfig, async () => {
        const extraction = await extractClaims(r.postContext);
        if (extraction.no_checkable_claims || extraction.claims.length === 0) {
          return { newVerdict: false, newReasoning: `no_checkable_claims: ${extraction.reasoning}`, claims: 0, noCheck: true };
        }
        const judgment = await judgeClaimsWithNote({
          claims: extraction.claims,
          researcherFindings: r.findings,
          noteText: r.noteText,
          sources: r.sources,
        });
        return {
          newVerdict: judgment.note_needed,
          newReasoning: judgment.reasoning,
          claims: extraction.claims.length,
          noCheck: false,
        };
      });
      newVerdict = out.newVerdict;
      newReasoning = out.newReasoning;
      claimsExtracted = out.claims;
      noCheckable = out.noCheck;
    } catch (err: any) {
      newReasoning = `ERR: ${err?.message ?? "unknown"}`;
    }

    const classification = classify(r.needsNote, r.iter4Verdict, newVerdict);
    results.push({
      url: r.url,
      needsNote: r.needsNote === "yes" || r.needsNote === "no" ? (r.needsNote as any) : "unknown",
      iter4Verdict: r.iter4Verdict,
      newVerdict,
      newReasoning,
      claimsExtracted,
      noCheckableClaims: noCheckable,
      classification,
    });

    const arrow = newVerdict === r.iter4Verdict ? "==" : "→→";
    const i4 = r.iter4Verdict === null ? "?" : r.iter4Verdict ? "T" : "F";
    const nu = newVerdict === null ? "?" : newVerdict ? "T" : "F";
    const idShort = r.url.replace(/^.*status\//, "");
    console.log(
      `[${(i + 1).toString().padStart(3)}/${judgeable.length}] needs=${r.needsNote.padEnd(3)} ${idShort.padEnd(20)} iter4=${i4} ${arrow} new=${nu} claims=${claimsExtracted} → ${classification}`,
    );
  }

  // Summary
  const bucket: Record<string, number> = {};
  for (const r of results) bucket[r.classification] = (bucket[r.classification] ?? 0) + 1;

  console.log("\n=== Classification counts ===");
  for (const [k, v] of Object.entries(bucket).sort()) console.log(`  ${k.padEnd(22)} ${v}`);

  // Ground-truth oriented metrics
  const truthYes = results.filter((r) => r.needsNote === "yes");
  const truthNo = results.filter((r) => r.needsNote === "no");
  const newCorrectYes = truthYes.filter((r) => r.newVerdict === true).length;
  const newCorrectNo = truthNo.filter((r) => r.newVerdict === false).length;
  const iter4CorrectYes = truthYes.filter((r) => r.iter4Verdict === true).length;
  const iter4CorrectNo = truthNo.filter((r) => r.iter4Verdict === false).length;

  console.log("\n=== Ground-truth accuracy (judge stage only) ===");
  console.log(`  YES truth (n=${truthYes.length}):  iter-4 correct=${iter4CorrectYes}  new correct=${newCorrectYes}  Δ=${newCorrectYes - iter4CorrectYes}`);
  console.log(`  NO  truth (n=${truthNo.length}):   iter-4 correct=${iter4CorrectNo}  new correct=${newCorrectNo}  Δ=${newCorrectNo - iter4CorrectNo}`);
  const iter4TotalCorrect = iter4CorrectYes + iter4CorrectNo;
  const newTotalCorrect = newCorrectYes + newCorrectNo;
  console.log(`  TOTAL    (n=${results.length}):   iter-4 correct=${iter4TotalCorrect}  new correct=${newTotalCorrect}  Δ=${newTotalCorrect - iter4TotalCorrect}`);

  fs.writeFileSync(path.join(OUT_DIR, "replay_results.json"), JSON.stringify(results, null, 2));
  console.log(`\nFull results → ${path.join(OUT_DIR, "replay_results.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
