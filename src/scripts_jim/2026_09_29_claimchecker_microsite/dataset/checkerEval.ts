/**
 * Eval 2: does the claim checker decide right on the claim?
 *
 * Each row's post goes through the whole claim check as the pipeline has it:
 * the topic filter, the research, the note writer and the source verifier. The
 * outcome is compared with the expected decision by a plain rule. For a note
 * where reference notes exist, a Muse judge also says whether the note makes
 * their point. Each row is checked three times, because the same check can end
 * differently each time, and passes when the decision was right in two.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { runClaimCheck } from "../../../everything/pipeline/checkClaims";
import { LOGS_DIR } from "../runStore";
import { checkTraceOf } from "../labRun";
import type { CheckerEvalResult, CheckerOutcome, CheckerPrompts, CheckerRowResult, CheckerSample, CheckerVerdict, DatasetRow } from "./evalTypes";
import { judgeNoteQuality } from "./judges";

const SAMPLES_PER_ROW = 3;
/** A row passes when the decision was the expected one in at least this many samples. */
const PASS_AT = 2;
const CHECK_CONCURRENCY = 6;

/** The decision rule: no model involved. */
export function verdictOf(expected: DatasetRow["expected"], outcome: CheckerOutcome): CheckerVerdict {
  if (outcome.type === "error") return "error";
  if (expected.decision === "note") return outcome.type === "note" ? "pass" : "fail";
  if (outcome.type === "no_note") return "pass";
  return expected.noteTolerated ? "soft_fail" : "fail";
}

/** The row's verdict over its samples. When too few passed, it is the way the
 *  samples most often went wrong, and a plain fail when they disagree. */
export function rowVerdictOf(verdicts: CheckerVerdict[]): { passedIn: number; verdict: CheckerVerdict } {
  const count = (v: CheckerVerdict) => verdicts.filter((x) => x === v).length;
  const passedIn = count("pass");
  if (passedIn >= PASS_AT) return { passedIn, verdict: "pass" };
  if (count("error") >= PASS_AT) return { passedIn, verdict: "error" };
  if (count("soft_fail") >= PASS_AT) return { passedIn, verdict: "soft_fail" };
  return { passedIn, verdict: "fail" };
}

/** Your own wording of the right note, and the real notes readers rated helpful. */
function referenceNotesOf(row: DatasetRow): string[] {
  const real = row.production.notes.filter((n) => n.votes.helpful > n.votes.notHelpful).map((n) => n.text);
  return [...(row.expected.referenceNote ? [row.expected.referenceNote] : []), ...real];
}

/** The user messages of the research step and the writer step, from the log of
 *  a check. A log written to disk keeps its messages under string keys, one
 *  held in memory keeps them in a list, so both are read. */
export function promptsOf(logs: any): CheckerPrompts {
  const search = logs?.note_writer_steps?.search?.messages;
  const attempts = logs?.note_writer_steps?.note_writer?.attempts;
  const firstAttempt = Array.isArray(attempts) ? attempts[0] : attempts?.["0"];
  const writerMessages: { role: string; content: string }[] = Array.isArray(firstAttempt?.messages) ? firstAttempt.messages : Object.values(firstAttempt?.messages ?? {});
  return {
    research: (Array.isArray(search) ? search[0] : search?.["0"])?.userMessage ?? null,
    writer: writerMessages.find((m) => m.role === "user")?.content ?? null,
  };
}

async function checkSample(row: DatasetRow, referenceNotes: string[], runId: string, index: number, sample: number): Promise<CheckerSample> {
  const base = { quality: null, research: null, draftNote: null, sourceVerdict: null, checkCostUsd: 0, judgeCostUsd: 0 };
  try {
    // The id has a hyphen, so it can never be mistaken for a tweet id, and it is new for every sample.
    const post = { ...row.checker.post, id: `eval-${runId}-${index}-${sample}` } as Parameters<typeof runClaimCheck>[0];
    const { check, run } = await runClaimCheck(post);
    mkdirSync(join(LOGS_DIR, `eval-${runId}`), { recursive: true });
    writeFileSync(join(LOGS_DIR, `eval-${runId}`, `${row.id}.${sample}.json`), JSON.stringify(run, null, 1));
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
    return { ...base, outcome, verdict: verdictOf(row.expected, outcome), quality, prompts: promptsOf(run.logs), research: trace.research, draftNote: trace.draftNote, sourceVerdict: trace.sourceVerdict, checkCostUsd: run.costUsd ?? 0, judgeCostUsd };
  } catch (err: any) {
    const outcome: CheckerOutcome = { type: "error", error: err?.message ?? String(err) };
    return { ...base, outcome, verdict: "error" };
  }
}

export async function runCheckerEval(rows: DatasetRow[], runId: string): Promise<CheckerEvalResult> {
  console.log(`Checker eval: ${rows.length} rows, ${SAMPLES_PER_ROW} samples each`);
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  const results: CheckerRowResult[] = await Promise.all(
    rows.map(async (row, index) => {
      const referenceNotes = referenceNotesOf(row);
      const samples = await Promise.all(
        Array.from({ length: SAMPLES_PER_ROW }, (_, sample) => queue.add(() => checkSample(row, referenceNotes, runId, index, sample)) as Promise<CheckerSample>),
      );
      const { passedIn, verdict } = rowVerdictOf(samples.map((s) => s.verdict));
      console.log(`  ${row.id}: ${verdict}, ${passedIn} of ${SAMPLES_PER_ROW} (${samples.map((s) => s.outcome.type).join(", ")})`);
      return { id: row.id, group: row.group, expected: row.expected, referenceNotes, samples, passedIn, verdict };
    }),
  );
  const all = results.flatMap((r) => r.samples);
  return {
    samples: SAMPLES_PER_ROW,
    passAt: PASS_AT,
    rows: results,
    costUsd: { checks: all.reduce((s, x) => s + x.checkCostUsd, 0), judge: all.reduce((s, x) => s + x.judgeCostUsd, 0) },
  };
}
