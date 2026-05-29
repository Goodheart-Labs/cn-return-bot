/**
 * Re-run only the UNKNOWN rows from replay_results.json — those failed during
 * a deepseek transient outage. Merges results back in.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords } from "../../utils/csv";
import { extractClaims, judgeClaimsWithNote } from "../../pipeline/simple-bot/judge";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";

const ITER4_CSV = "dataset_runs/tryout-iter-04-cheap-bot-merged/results_iter-04-cheap-bot.csv";
const RESULTS_FILE = "src/scripts_jim/2026_05_28_judge_iter4/replay_results.json";

function splitWriterUserMessage(userMessage: string): { postContext: string; findings: string } {
  const i = userMessage.indexOf("## Research findings");
  if (i < 0) return { postContext: userMessage.trim(), findings: "" };
  return { postContext: userMessage.slice(0, i).trim(), findings: userMessage.slice(i).trim() };
}

function classify(needsNote: string, iter4: boolean | null, neu: boolean | null): string {
  if (neu === null) return "UNKNOWN";
  const truth = needsNote === "yes";
  if (truth && neu) return iter4 === true ? "TP_KEPT" : "MISS_UNBLOCKED";
  if (truth && !neu) return iter4 === true ? "TP_LOST" : "MISS_STILL_BLOCKED";
  if (!truth && neu) return iter4 === true ? "FP_KEPT" : "FP_REGRESSION";
  return iter4 === true ? "FP_FIXED" : "TP_KEPT";
}

async function main() {
  const prev = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8")) as any[];
  const unknowns = prev.filter((r) => r.classification === "UNKNOWN");
  console.log(`re-running ${unknowns.length} UNKNOWN rows`);

  const csv = parseCsvRecords(fs.readFileSync(ITER4_CSV, "utf8").trim());
  const headers = csv[0]!.map((h) => h.trim());
  const rows = csv.slice(1).map((f) => {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => (r[h] = f[i] ?? ""));
    return r;
  });
  const byUrl = new Map(rows.map((r) => [r.url, r]));

  const cfg: BotConfig = { ...DEFAULT_CONFIG, botId: "cheap-bot", model: "deepseek/deepseek-v4-flash", reasoning_effort: "low" };

  for (let i = 0; i < unknowns.length; i++) {
    const u = unknowns[i]!;
    const row = byUrl.get(u.url);
    if (!row) { console.log(`[${i + 1}] no row for ${u.url}`); continue; }
    let logs: any;
    try { logs = JSON.parse(row.logs); } catch { continue; }
    const attempt0 = logs?.simpleBot?.writer?.attempts?.["0"];
    const msg = attempt0?.messages?.[1]?.content ?? "";
    const resp = attempt0?.response;
    if (!msg || !resp?.note_text) continue;
    const { postContext, findings } = splitWriterUserMessage(msg);
    const sources: string[] = Array.isArray(resp.sources) ? resp.sources : [];

    try {
      const out = await withBotConfig(cfg, async () => {
        const e = await extractClaims(postContext);
        if (e.no_checkable_claims || e.claims.length === 0) {
          return { verdict: false, reasoning: `no_checkable_claims: ${e.reasoning}`, claims: 0 };
        }
        const j = await judgeClaimsWithNote({
          claims: e.claims,
          researcherFindings: findings,
          noteText: resp.note_text,
          sources,
        });
        return { verdict: j.note_needed, reasoning: j.reasoning, claims: e.claims.length };
      });
      u.newVerdict = out.verdict;
      u.newReasoning = out.reasoning;
      u.claimsExtracted = out.claims;
      u.classification = classify(u.needsNote, u.iter4Verdict, out.verdict);
      console.log(`[${i + 1}/${unknowns.length}] ${u.url.replace(/^.*status\//, "")} → ${u.classification} (${out.verdict ? "T" : "F"})`);
    } catch (err: any) {
      u.newReasoning = `ERR retry: ${err?.message}`;
      console.log(`[${i + 1}/${unknowns.length}] still failed: ${err?.message}`);
    }
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(prev, null, 2));

  // Recompute summary
  const bucket: Record<string, number> = {};
  for (const r of prev) bucket[r.classification] = (bucket[r.classification] ?? 0) + 1;
  console.log("\n=== Final classification counts ===");
  for (const [k, v] of Object.entries(bucket).sort()) console.log(`  ${k.padEnd(22)} ${v}`);

  const truthYes = prev.filter((r) => r.needsNote === "yes");
  const truthNo = prev.filter((r) => r.needsNote === "no");
  const newCorrectYes = truthYes.filter((r) => r.newVerdict === true).length;
  const newCorrectNo = truthNo.filter((r) => r.newVerdict === false).length;
  const iter4CorrectYes = truthYes.filter((r) => r.iter4Verdict === true).length;
  const iter4CorrectNo = truthNo.filter((r) => r.iter4Verdict === false).length;
  console.log("\n=== Ground-truth accuracy (judge stage) ===");
  console.log(`  YES truth (n=${truthYes.length}):  iter-4=${iter4CorrectYes} new=${newCorrectYes} Δ=${newCorrectYes - iter4CorrectYes}`);
  console.log(`  NO  truth (n=${truthNo.length}):   iter-4=${iter4CorrectNo} new=${newCorrectNo} Δ=${newCorrectNo - iter4CorrectNo}`);
  console.log(`  TOTAL    (n=${prev.length}):   iter-4=${iter4CorrectYes + iter4CorrectNo} new=${newCorrectYes + newCorrectNo} Δ=${newCorrectYes + newCorrectNo - iter4CorrectYes - iter4CorrectNo}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
