/**
 * Simple Bot Orchestrator
 *
 * Linear three-stage pipeline: search → write → verify.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineOutcome } from "../../bots/types";
import type { BotInput } from "../input/createBotInput";
import { buildUserMessage } from "../input/prompt";
import { getTweetLog } from "../utils/tweetLog";
import { verifySources } from "../verify/sourceVerifier";
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

  const verification = await verifySources({
    noteText: note.noteText,
    sources: note.sources,
    postContext: userMessage,
    researcherFindings: search.findings,
    turnNumber: 1,
  });

  logFinal(startMs);

  if (verification.accepted) {
    return { type: "note", noteText: note.noteText, sources: note.sources, searchResults: search.findings };
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
