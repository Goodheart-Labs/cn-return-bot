/**
 * Eval 2: does the claim checker decide right on the claim?
 *
 * Each row's post goes through the whole claim check as the pipeline has it:
 * the topic filter, the research, the note writer and the source verifier. The
 * outcome is compared with the expected decision by a plain rule. For a note
 * where reference notes exist, a Muse judge also says whether the note makes
 * their point. Each row is checked once.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { runClaimCheck } from "../../../everything/pipeline/checkClaims";
import { LOGS_DIR } from "../runStore";
import { checkTraceOf } from "../labRun";
import type { CheckerEvalResult, CheckerOutcome, CheckerRowResult, CheckerVerdict, DatasetRow } from "./evalTypes";
import { judgeNoteQuality } from "./judges";

const CHECK_CONCURRENCY = 6;

/** The decision rule: no model involved. */
export function verdictOf(expected: DatasetRow["expected"], outcome: CheckerOutcome): CheckerVerdict {
  if (outcome.type === "error") return "error";
  if (expected.decision === "note") return outcome.type === "note" ? "pass" : "fail";
  if (outcome.type === "no_note") return "pass";
  return expected.noteTolerated ? "soft_fail" : "fail";
}

/** Your own wording of the right note, and the real notes readers rated helpful. */
function referenceNotesOf(row: DatasetRow): string[] {
  const real = row.production.notes.filter((n) => n.votes.helpful > n.votes.notHelpful).map((n) => n.text);
  return [...(row.expected.referenceNote ? [row.expected.referenceNote] : []), ...real];
}

async function checkRow(row: DatasetRow, runId: string, index: number): Promise<CheckerRowResult> {
  const referenceNotes = referenceNotesOf(row);
  const base = { id: row.id, group: row.group, expected: row.expected, referenceNotes, quality: null, research: null, draftNote: null, sourceVerdict: null, checkCostUsd: 0, judgeCostUsd: 0 };
  try {
    // The id has a hyphen, so it can never be mistaken for a tweet id, and it is new in every run.
    const post = { ...row.checker.post, id: `eval-${runId}-${index}` } as Parameters<typeof runClaimCheck>[0];
    const { check, run } = await runClaimCheck(post);
    mkdirSync(join(LOGS_DIR, `eval-${runId}`), { recursive: true });
    writeFileSync(join(LOGS_DIR, `eval-${runId}`, `${row.id}.json`), JSON.stringify(run, null, 1));
    const trace = checkTraceOf(run.logs);
    const outcome: CheckerOutcome =
      check.kind === "note" ? { type: "note", note: check.note, sources: check.sources } : { type: "no_note", reason: check.reason ?? check.outcome };
    let quality = null;
    let judgeCostUsd = 0;
    if (outcome.type === "note" && row.expected.decision === "note" && referenceNotes.length > 0) {
      const judged = await judgeNoteQuality(row.checker.post.text, referenceNotes, outcome.note);
      quality = judged.answer;
      judgeCostUsd = judged.costUsd;
    }
    return { ...base, outcome, verdict: verdictOf(row.expected, outcome), quality, research: trace.research, draftNote: trace.draftNote, sourceVerdict: trace.sourceVerdict, checkCostUsd: run.costUsd ?? 0, judgeCostUsd };
  } catch (err: any) {
    const outcome: CheckerOutcome = { type: "error", error: err?.message ?? String(err) };
    return { ...base, outcome, verdict: "error" };
  }
}

export async function runCheckerEval(rows: DatasetRow[], runId: string): Promise<CheckerEvalResult> {
  console.log(`Checker eval: ${rows.length} rows, once each`);
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  const results = await Promise.all(
    rows.map(
      (row, index) =>
        queue.add(async () => {
          const result = await checkRow(row, runId, index);
          console.log(`  ${row.id}: ${result.verdict} (${result.outcome.type})`);
          return result;
        }) as Promise<CheckerRowResult>,
    ),
  );
  return { rows: results, costUsd: { checks: results.reduce((s, r) => s + r.checkCostUsd, 0), judge: results.reduce((s, r) => s + r.judgeCostUsd, 0) } };
}
