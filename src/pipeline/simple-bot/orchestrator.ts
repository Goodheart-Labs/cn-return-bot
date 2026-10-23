/**
 * The simple bot's orchestrator.
 *
 * The pipeline is linear. It searches, then writes a note, then verifies the
 * note's sources unless the bot config switches the verifier off.
 *
 * The search and write stages are wrapped in withWriterCache. When the
 * WRITER_CACHE directory already holds an entry for this tweet, the run is a
 * replay. It skips searching and writing and starts at the source verifier.
 * When the environment variable is unset nothing is cached and the full
 * pipeline runs.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineOutcome } from "../../bots/types";
import type { BotInput } from "../input/createBotInput";
import { buildUserMessageFromInput } from "../prompts/input/userMessage";
import { getTweetLog } from "../utils/tweetLog";
import { STEP } from "../utils/noteWriterSteps";
import { UnfetchableSourcesError } from "../utils/errors";
import { verifySources, type SourceVerification } from "../verify/sourceVerifier";
import { withWriterCache, type WriterStageResult } from "../replay/writerCache";
import { getBotConfig } from "../ab-testing/botConfig";
import { runCascadingSearch } from "./cascadeSearch";
import { reviseResearch } from "./secondRound";
import { runSearch } from "./search";
import { canTakeFollowUp } from "./searchDispatch";
import { runTimingStage } from "./timingStage";
import { runWriter } from "./writer";
import { topicSourcelessRejection } from "../utils/noteLint";

const WRITER_EMPTY_NOTE_REASON = "The writer found nothing in the findings that disputes a claim the post rests on.";

export async function runSimpleBotPipeline(
  post: Post,
  input: BotInput,
): Promise<PipelineOutcome> {
  const startMs = Date.now();

  const cached = await withWriterCache(post.id, () => produceWriterOutput(post, input));
  const stage = cached.kind === "researched" ? await writeNote(cached) : cached;
  const outcome = stage.kind === "early_exit" ? stage.outcome : await runGatesWithSecondRound(stage);

  logFinal(startMs);
  return outcome;
}

/** Runs the search stage and then the writer. It returns an early exit when the
 *  search finds nothing to dispute. Otherwise it returns the written note for
 *  the verifier to run on. */
async function produceWriterOutput(post: Post, input: BotInput): Promise<WriterStageResult> {
  const userMessage = buildUserMessageFromInput(post, input);

  const search = getBotConfig().search_cascade ? await runCascadingSearch(userMessage) : await runSearch(userMessage);
  if (!search.correctionNeeded) {
    return { kind: "early_exit", outcome: { type: "no_correction", reason: search.findings, searchResults: search.findings } };
  }

  // Information for the writer, not a gate: a post published within
  // LIVE_EVENT_WINDOW_HOURS of the event it describes gets a timing block.
  const timing = await runTimingStage({ userMessage, findings: search.findings, postCreatedAt: post.created_at });
  const timingContext = timing.action === "inform" ? timing.contextBlock : undefined;

  return writeNote({ kind: "researched", userMessage, findings: search.findings, answer: search.answer, researchedBy: search.researchedBy ?? "full", timingContext });
}

type Researched = Extract<WriterStageResult, { kind: "researched" }>;

/** Runs the writer on the findings of the research step. */
async function writeNote(researched: Researched): Promise<Exclude<WriterStageResult, { kind: "researched" }>> {
  const { userMessage, findings, answer, researchedBy, timingContext } = researched;
  const note = await runWriter(userMessage, findings, { timingContext });
  // The writer answers with an empty note when nothing in the findings disputes
  // a claim the post rests on. That is a "no note needed" answer, the same as
  // the search step's, and not a note. Without this exit the empty note went on
  // to the verifier, which sometimes accepted it by judging the findings, and
  // Common Notes then published notes with no text.
  if (note.noteText.trim() === "") {
    return { kind: "early_exit", outcome: { type: "no_correction", reason: WRITER_EMPTY_NOTE_REASON, searchResults: findings } };
  }
  return {
    kind: "writer_done",
    userMessage,
    findings,
    answer,
    queries: [],
    noteText: note.noteText,
    sources: note.sources,
    snippets: [],
    researchedBy,
    timingContext,
  };
}

type WriterDone = Extract<WriterStageResult, { kind: "writer_done" }>;

/** Runs the source verifier. It runs on every full pipeline run and on every
 *  cache replay. It also returns what the verifier said, for a second round. */
async function runGates(
  stage: WriterDone,
  turnNumber = 1,
): Promise<{ outcome: PipelineOutcome; verification: SourceVerification }> {
  const { userMessage, findings, noteText, sources } = stage;

  const verification = await verifySources({
    noteText,
    sources,
    postContext: userMessage,
    researcherFindings: findings,
    turnNumber,
  });

  if (verification.accepted) {
    // A curated-topic note must keep at least one verified source. The classic
    // verifier can accept a note while marking every one of its URLs bad. See
    // topicSourcelessRejection.
    const sourceless = topicSourcelessRejection(verification.good_sources);
    if (sourceless) {
      return { outcome: { type: "verification_failed", noteText, sources, reason: sourceless, searchResults: findings }, verification };
    }
    // Drop the URLs the verifier marked bad. Such a URL either supports no claim
    // in the note or failed to fetch, so the published note should not carry it.
    const goodSet = new Set(verification.good_sources);
    return {
      outcome: {
        type: "note",
        noteText,
        sources: verification.good_sources,
        verified: true,
        searchResults: findings,
        // Keep only the evaluations for sources the published note carries.
        sourceEvaluations: verification.source_evaluations?.filter((e) => goodSet.has(e.url)),
      },
      verification,
    };
  }
  return {
    outcome: {
      type: "verification_failed",
      noteText,
      sources,
      reason: verification.reasoning,
      searchResults: findings,
    },
    verification,
  };
}

/** Runs the source verifier, and when it rejects the note on a run on the
 *  second_round arm, gives the research one more turn. The first findings, the
 *  note and the verifier's reasoning are kept in the log under second_round,
 *  because the second round writes over the search and writer entries. */
async function runGatesWithSecondRound(stage: WriterDone): Promise<PipelineOutcome> {
  // Common Notes does not check sources, and neither does a bot config that
  // switches the verifier off. The note goes on with every source the writer
  // cited, and it has no quotes from the sources.
  if (getBotConfig().commonnotes_pipeline || !getBotConfig().source_verifier) {
    return { type: "note", noteText: stage.noteText, sources: stage.sources, verified: false, searchResults: stage.findings };
  }
  const first = await runGates(stage);
  const config = getBotConfig();
  // The quick research answers follow-ups with its own model. The full research needs a provider that can take one.
  const canAsk = stage.researchedBy === "quick" || canTakeFollowUp(config);
  if (first.outcome.type !== "verification_failed" || !config.second_round || !canAsk) return first.outcome;

  const log = getTweetLog();
  log?.set("second_round.first", { findings: stage.findings, note: stage.noteText, sources: stage.sources, reasoning: first.verification.reasoning });
  const revised = await reviseResearch({
    userMessage: stage.userMessage,
    findings: stage.findings,
    answer: stage.answer,
    researchedBy: stage.researchedBy ?? "full",
    noteText: stage.noteText,
    verification: first.verification,
  });
  log?.set("second_round.revised_findings", revised.findings);
  if (revised.withdrew) {
    log?.set("second_round.result", "research_withdrew");
    return { type: "no_correction", reason: revised.findings };
  }
  const note = await runWriter(stage.userMessage, revised.findings, { timingContext: stage.timingContext });
  if (note.noteText.trim() === "") {
    log?.set("second_round.result", "writer_empty");
    return { type: "no_correction", reason: WRITER_EMPTY_NOTE_REASON };
  }
  log?.set("second_round.second_note", { note: note.noteText, sources: note.sources });
  try {
    const second = await runGates({ ...stage, findings: revised.findings, noteText: note.noteText, sources: note.sources }, 2);
    log?.set("second_round.result", second.outcome.type);
    return second.outcome;
  } catch (err) {
    // The revised sources could not be opened at all. The first rejection still stands, so the check ends as it would have without a second round.
    if (!(err instanceof UnfetchableSourcesError)) throw err;
    log?.set("second_round.result", "unfetchable_sources");
    log?.set("second_round.error", err.message);
    return first.outcome;
  }
}

function logFinal(startMs: number): void {
  const log = getTweetLog();
  log?.set(`${STEP.root}.totalDurationMs`, Date.now() - startMs);
}
