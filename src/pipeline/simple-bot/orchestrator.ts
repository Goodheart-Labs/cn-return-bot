/**
 * The simple bot's orchestrator.
 *
 * The pipeline is linear. It searches, then writes a note, then verifies the
 * note's sources.
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
import { getBotConfig } from "../ab-testing/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { STEP } from "../utils/noteWriterSteps";
import { verifySources } from "../verify/sourceVerifier";
import { withWriterCache, type WriterStageResult } from "../replay/writerCache";
import {
  HIGH_VALUE_CATEGORIES,
  formatCorrectionsForWriter,
} from "../prompts/simple-bot/correctionExtractor";
import { runSearch } from "./search";
import { runCorrectionExtractor } from "./correctionExtractor";
import { runTimingStage } from "./timingStage";
import { runWriter } from "./writer";
import { topicSourcelessRejection } from "../utils/noteLint";

export async function runSimpleBotPipeline(
  post: Post,
  input: BotInput,
): Promise<PipelineOutcome> {
  const startMs = Date.now();

  const stage = await withWriterCache(post.id, () => produceWriterOutput(post, input));
  const outcome = stage.kind === "early_exit" ? stage.outcome : await runGates(stage);

  logFinal(startMs);
  return outcome;
}

/** Runs the search stage and then the writer. It returns an early exit when the
 *  search finds nothing to dispute. Otherwise it returns the written note for
 *  the verifier to run on. */
async function produceWriterOutput(post: Post, input: BotInput): Promise<WriterStageResult> {
  const userMessage = buildUserMessageFromInput(post, input);

  const search = await runSearch(userMessage);
  if (!search.correctionNeeded) {
    return { kind: "early_exit", outcome: { type: "no_correction", reason: search.findings } };
  }

  // The timing stage runs only on the timing_context ON arm. That arm is
  // independent of the time_travel_prompt instruction test, so the two form a
  // 2x2. A post about an event that has already settled passes through
  // untouched. A post published within six hours of its event, or in the middle
  // of the event, gets a block of timing context added to the writer's user
  // message. The block is information and not a gate. The writer still decides.
  let timingContext: string | undefined;
  if (getBotConfig().timing_context) {
    const timing = await runTimingStage({ userMessage, findings: search.findings, postCreatedAt: post.created_at });
    if (timing.action === "inform") timingContext = timing.contextBlock;
  }

  let writerFindings = search.findings;
  if (getBotConfig().correction_extraction) {
    const corrections = await runCorrectionExtractor(search.findings);
    const highValue = corrections.filter((c) => HIGH_VALUE_CATEGORIES.includes(c.category));
    if (highValue.length === 0) {
      return {
        kind: "early_exit",
        outcome: {
          type: "no_correction",
          reason: `correction extractor found no clear_error / critical_context items (${corrections.length} lower-value dropped)`,
        },
      };
    }
    writerFindings = formatCorrectionsForWriter(highValue);
  }

  const note = await runWriter(userMessage, writerFindings, { timingContext });
  return {
    kind: "writer_done",
    userMessage,
    // This holds the filtered corrections, or the raw findings when correction
    // extraction is off. The writer and the source verifier both read it as
    // stage.findings, and it is also what gets logged.
    findings: writerFindings,
    queries: [],
    noteText: note.noteText,
    sources: note.sources,
    snippets: [],
  };
}

/** Runs the source verifier. It runs on every full pipeline run and on every
 *  cache replay. */
async function runGates(stage: Extract<WriterStageResult, { kind: "writer_done" }>): Promise<PipelineOutcome> {
  const { userMessage, findings, noteText, sources } = stage;

  const verification = await verifySources({
    noteText,
    sources,
    postContext: userMessage,
    researcherFindings: findings,
    turnNumber: 1,
  });

  if (verification.accepted) {
    // A curated-topic note must keep at least one verified source. The classic
    // verifier can accept a note while marking every one of its URLs bad. See
    // topicSourcelessRejection.
    const sourceless = topicSourcelessRejection(verification.good_sources);
    if (sourceless) {
      return { type: "verification_failed", noteText, sources, reason: sourceless, searchResults: findings };
    }
    // Drop the URLs the verifier marked bad. Such a URL either supports no claim
    // in the note or failed to fetch, so the published note should not carry it.
    const goodSet = new Set(verification.good_sources);
    return {
      type: "note",
      noteText,
      sources: verification.good_sources,
      searchResults: findings,
      // Keep only the evaluations for sources the published note carries.
      sourceEvaluations: verification.source_evaluations?.filter((e) => goodSet.has(e.url)),
    };
  }
  return {
    type: "verification_failed",
    noteText,
    sources,
    reason: verification.reasoning,
    searchResults: findings,
  };
}

function logFinal(startMs: number): void {
  const log = getTweetLog();
  log?.set(`${STEP.root}.totalDurationMs`, Date.now() - startMs);
}
