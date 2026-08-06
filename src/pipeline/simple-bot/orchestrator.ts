/**
 * Simple Bot Orchestrator
 *
 * Linear three-stage pipeline: search → write → verify.
 *
 * The writer stage is wrapped in withWriterCache: when WRITER_CACHE is
 * populated (replay), search + write are skipped and the run starts from the
 * gates (judge + verifier). Unset env = full pipeline, no caching.
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

/** Search → write. Returns a terminal early-exit when search finds no dispute,
 *  or the written note (writer_done) for the gates to run on. */
async function produceWriterOutput(post: Post, input: BotInput): Promise<WriterStageResult> {
  const userMessage = buildUserMessageFromInput(post, input);

  const search = await runSearch(userMessage);
  if (!search.correctionNeeded) {
    return { kind: "early_exit", outcome: { type: "no_correction", reason: search.findings } };
  }

  // Timing stage (timing_context ON arm — independent of the time_travel_prompt
  // instruction test; the two compose as a 2x2): settled-event posts pass
  // through untouched; fog-window posts (published within 6h of their event,
  // or mid-event) get a timing-context block piped into the writer's user
  // message. Information, not a gate — the writer decides.
  let timingContext: string | undefined;
  if (getBotConfig().timing_context) {
    const timing = await runTimingStage({ userMessage, findings: search.findings });
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
    // Filtered corrections (or raw findings when extraction is off) — the writer AND
    // the source verifier both read this via stage.findings; also what's logged.
    findings: writerFindings,
    queries: [],
    noteText: note.noteText,
    sources: note.sources,
    snippets: [],
  };
}

/** Source verifier. Runs on every full pipeline and on every cache replay. */
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
    // Curated-topic notes must keep ≥1 verified source (the classic verifier
    // can accept while classifying every URL bad — see topicSourcelessRejection).
    const sourceless = topicSourcelessRejection(verification.good_sources);
    if (sourceless) {
      return { type: "verification_failed", noteText, sources, reason: sourceless, searchResults: findings };
    }
    // Drop URLs the verifier classified as bad — they don't support any claim
    // (or failed to fetch), so we don't want them in the published note.
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
