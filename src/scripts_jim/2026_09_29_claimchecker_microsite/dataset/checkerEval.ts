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
import { spyOn } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { writeInputCacheMem } from "../../../pipeline/input/inputCache";
import * as noteEvaluationFilter from "../../../pipeline/score/noteEvaluationFilter";
import { runClaimCheck } from "../../../everything/pipeline/checkClaims";
import { CASCADE_COMMONNOTES_STRONG_MODEL } from "../../../pipeline/simple-bot/cascadeSearch";
import { AB_TESTS } from "../../../pipeline/ab-testing/abTestsData";
import { LOGS_DIR } from "../runStore";
import { checkTraceOf } from "../labRun";
import type { CascadeTrace, CheckableRow, CheckerEvalResult, CheckerOutcome, CheckerPrompts, CheckerRowResult, CheckerSample, CheckerVerdict } from "./evalTypes";
import { judgeNoteQuality } from "./judges";

const SAMPLES_PER_ROW = 3;
/** A row passes when the decision was the expected one in at least this many samples. */
const PASS_AT = 2;
const CHECK_CONCURRENCY = 6;
/** The picks that make a tweet run as the X bot runs it: the X prompts and the X bot's settings, with fixed models so that runs can be compared. */
const X_POST_PICKS: Record<string, string> = {
  commonnotes_pipeline: "off",
  note_prefilter: "deepseek",
  simple_bot_search: "sonnet5-native",
  simple_bot_writer: "sonnet5",
  simple_bot_verifier: "gemini-flash",
  verifier_claim_based: "claim-based",
  verifier_citations: "off",
  materiality_treatment: "writer_central",
  author_history: "off",
};
/** The input of a tweet is the tweet alone: no replies, no past notes on its author (our own note could be among them), no media. */
const X_POST_INPUT = { mediaResult: { tweetMedia: [], quotedTweetMedia: [] }, mediaMadeWithAiLabel: false };
const X_POST_VIDEO_STRATEGY = "frames";

/** The decision rule: no model involved. */
export function verdictOf(expected: CheckableRow["expected"], outcome: CheckerOutcome): CheckerVerdict {
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
function referenceNotesOf(row: CheckableRow): string[] {
  const real = row.production.notes.filter((n) => n.votes.helpful > n.votes.notHelpful).map((n) => n.text);
  return [...(row.expected.referenceNote ? [row.expected.referenceNote] : []), ...real];
}

/** The model that an A/B arm picked for one config field, for example the search model of the arm "gpt6luna-native". */
function pickedModel(picks: Record<string, string> | null, testName: string, field: "search_model" | "writer_model" | "verifier_model"): string | null {
  const variant = AB_TESTS.find((test) => test.name === testName)?.variants.find((v) => v.variant.name === picks?.[testName]);
  return (variant?.variant.overrides as Record<string, string | undefined> | undefined)?.[field] ?? null;
}

/** The models of a check, from its picks. The full research does not run when the quick research decided alone. A claim that is escalated goes to the cascade's own strong model. */
export function modelsOf(picks: Record<string, string> | null, cascade: CascadeTrace | null): NonNullable<CheckerSample["models"]> {
  const skipsResearch = cascade?.decision === "note" || cascade?.decision === "no_note";
  const search = skipsResearch ? null : cascade && picks?.commonnotes_pipeline === "on" ? CASCADE_COMMONNOTES_STRONG_MODEL : pickedModel(picks, "simple_bot_search", "search_model");
  return { search, writer: pickedModel(picks, "simple_bot_writer", "writer_model"), verifier: pickedModel(picks, "simple_bot_verifier", "verifier_model") };
}

/** What the cascade's quick research did, from the log of a check. It is null when the check ran on the precheck path. */
export function cascadeOf(logs: any): CascadeTrace | null {
  const cascade = logs?.cascade;
  if (!cascade) return null;
  const weak = logs?.note_writer_steps?.weak_search?.messages;
  return {
    probability: cascade.probability,
    decision: cascade.decision,
    answeredBy: cascade.answered_by,
    findings: weak?.["1"]?.content?.findings ?? null,
    userMessage: weak?.["0"]?.userMessage ?? null,
  };
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

async function checkSample(row: CheckableRow, referenceNotes: string[], runId: string, index: number, sample: number, picks: Record<string, string>): Promise<CheckerSample> {
  const base = { quality: null, research: null, draftNote: null, sourceVerdict: null, checkCostUsd: 0, judgeCostUsd: 0 };
  try {
    // A claim's id has a hyphen, so it can never be mistaken for a tweet id, and it is new for every sample. A tweet keeps its own id.
    const post = (row.xPost ? row.checker.post : { ...row.checker.post, id: `eval-${runId}-${index}-${sample}` }) as Parameters<typeof runClaimCheck>[0];
    if (row.xPost) writeInputCacheMem(post.id, X_POST_VIDEO_STRATEGY, X_POST_INPUT);
    const { check, run } = await runClaimCheck(post, row.xPost ? { ...X_POST_PICKS, ...picks } : picks);
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
    return { ...base, outcome, verdict: verdictOf(row.expected, outcome), quality, prompts: promptsOf(run.logs), research: trace.research, cascade: cascadeOf(run.logs), models: modelsOf(run.abTestPicks as Record<string, string> | null, cascadeOf(run.logs)), draftNote: trace.draftNote, sourceVerdict: trace.sourceVerdict, checkCostUsd: run.costUsd ?? 0, judgeCostUsd };
  } catch (err: any) {
    const outcome: CheckerOutcome = { type: "error", error: err?.message ?? String(err) };
    return { ...base, outcome, verdict: "error" };
  }
}

export async function runCheckerEval(rows: CheckableRow[], runId: string, picks: Record<string, string>): Promise<CheckerEvalResult> {
  console.log(`Checker eval: ${rows.length} rows, ${SAMPLES_PER_ROW} samples each`);
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  // X's evaluate endpoint scores a note against the real tweet. The eval must not call it.
  const evaluation = spyOn(noteEvaluationFilter, "getEvaluationScore").mockResolvedValue({});
  const results: CheckerRowResult[] = await Promise.all(
    rows.map(async (row, index) => {
      const referenceNotes = referenceNotesOf(row);
      const samples = await Promise.all(
        Array.from({ length: SAMPLES_PER_ROW }, (_, sample) => queue.add(() => checkSample(row, referenceNotes, runId, index, sample, picks)) as Promise<CheckerSample>),
      );
      const { passedIn, verdict } = rowVerdictOf(samples.map((s) => s.verdict));
      console.log(`  ${row.id}: ${verdict}, ${passedIn} of ${SAMPLES_PER_ROW} (${samples.map((s) => s.outcome.type).join(", ")})`);
      return { id: row.id, group: row.group, expected: row.expected, referenceNotes, samples, passedIn, verdict };
    }),
  );
  evaluation.mockRestore();
  const all = results.flatMap((r) => r.samples);
  return {
    samples: SAMPLES_PER_ROW,
    passAt: PASS_AT,
    rows: results,
    costUsd: { checks: all.reduce((s, x) => s + x.checkCostUsd, 0), judge: all.reduce((s, x) => s + x.judgeCostUsd, 0) },
  };
}
