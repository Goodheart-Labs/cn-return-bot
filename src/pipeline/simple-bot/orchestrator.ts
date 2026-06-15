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
import { getBotConfig } from "../ab-testing/botConfig";
import type { BotInput } from "../input/createBotInput";
import { buildUserMessageFromInput } from "../input/prompt";
import { getTweetLog } from "../utils/tweetLog";
import { STEP } from "../utils/noteWriterSteps";
import { verifySources } from "../verify/sourceVerifier";
import { withWriterCache, type WriterStageResult } from "../replay/writerCache";
import { runNoteNeededJudge } from "./judge";
import { runSearch } from "./search";
import { runWriter } from "./writer";

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

  const note = await runWriter(userMessage, search.findings);
  return {
    kind: "writer_done",
    userMessage,
    findings: search.findings,
    queries: [],
    noteText: note.noteText,
    sources: note.sources,
    snippets: [],
  };
}

/** Note-needed judge (when enabled) → source verifier. Runs on every full
 *  pipeline and on every cache replay. */
async function runGates(stage: Extract<WriterStageResult, { kind: "writer_done" }>): Promise<PipelineOutcome> {
  const { userMessage, findings, noteText, sources } = stage;

  if (getBotConfig().note_needed_judge) {
    const judge = await runNoteNeededJudge({
      postContext: userMessage,
      researcherFindings: findings,
      noteText,
      sources,
    });
    if (!judge.noteNeeded) {
      return { type: "no_correction", reason: judge.reasoning };
    }
  }

  const verification = await verifySources({
    noteText,
    sources,
    postContext: userMessage,
    researcherFindings: findings,
    turnNumber: 1,
  });

  if (verification.accepted) {
    // Drop URLs the verifier classified as bad — they don't support any claim
    // (or failed to fetch), so we don't want them in the published note.
    return { type: "note", noteText, sources: verification.good_sources, searchResults: findings };
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
