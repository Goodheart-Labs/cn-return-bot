/**
 * Simple Bot Orchestrator
 *
 * Linear three-stage pipeline: search → write → verify.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineOutcome } from "../../bots/types";
import { getBotConfig } from "../ab-testing/botConfig";
import type { BotInput } from "../input/createBotInput";
import { buildUserMessage } from "../input/prompt";
import { getTweetLog } from "../utils/tweetLog";
import { verifySources } from "../verify/sourceVerifier";
import { runNoteNeededJudge } from "./judge";
import { runSearch } from "./search";
import { runWriter } from "./writer";

export async function runSimpleBotPipeline(
  post: Post,
  input: BotInput,
): Promise<PipelineOutcome> {
  const startMs = Date.now();

  const userMessage = buildUserMessage({
    post,
    tweetMedia: input.mediaResult.tweetMedia,
    quotedTweetMedia: input.mediaResult.quotedTweetMedia,
    authorNoteHistory: input.authorHistory,
    comments: input.comments,
  });

  const search = await runSearch(userMessage);
  if (!search.correctionNeeded) {
    logFinal(startMs);
    return { type: "no_correction", reason: search.findings };
  }

  const note = await runWriter(userMessage, search.findings);

  if (getBotConfig().note_needed_judge) {
    const judge = await runNoteNeededJudge({
      postContext: userMessage,
      researcherFindings: search.findings,
      noteText: note.noteText,
      sources: note.sources,
    });
    if (!judge.noteNeeded) {
      logFinal(startMs);
      return { type: "no_correction", reason: judge.reasoning };
    }
  }

  const verification = await verifySources({
    noteText: note.noteText,
    sources: note.sources,
    postContext: userMessage,
    researcherFindings: search.findings,
    turnNumber: 1,
  });

  logFinal(startMs);

  if (verification.accepted) {
    // Drop URLs the verifier classified as bad — they don't support any claim
    // (or failed to fetch), so we don't want them in the published note.
    return { type: "note", noteText: note.noteText, sources: verification.good_sources, searchResults: search.findings };
  }
  return {
    type: "verification_failed",
    noteText: note.noteText,
    sources: note.sources,
    reason: verification.reasoning,
    searchResults: search.findings,
  };
}

function logFinal(startMs: number): void {
  const log = getTweetLog();
  log?.set("simpleBot.totalDurationMs", Date.now() - startMs);
}
