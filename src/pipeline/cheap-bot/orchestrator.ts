/**
 * cheap-bot Orchestrator
 *
 * 5-stage pipeline for hill-climbing the new bot against datasets/big_eval:
 *   1. Query writer  (DeepSeek; produces 1-3 search queries)
 *   2. searXNG fetch (no LLM; runs each query, combines results)
 *   3. Note writer   (reuses simple-bot's writer with DeepSeek)
 *   4. Note-needed judge (reuses simple-bot's judge with DeepSeek — always on)
 *   5. Source verifier (reuses verify/sourceVerifier with DeepSeek)
 *
 * Stages 3-5 are reused as-is from simple-bot / verify so we're not
 * maintaining two copies of those. The model cascade comes from bot config
 * picks declared in abTestsData.ts (BOT_TEST.cheap-bot variant).
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineOutcome } from "../../bots/types";
import type { BotInput } from "../input/createBotInput";
import { buildUserMessage } from "../input/prompt";
import { fetchSearxngResults, formatSearxngResults, type SearxngResult } from "../tool-calling/tools";
import { getTweetLog } from "../utils/tweetLog";
import { verifySources } from "../verify/sourceVerifier";
import { runNoteNeededJudge } from "../simple-bot/judge";
import { runWriter } from "../simple-bot/writer";
import { runQueryWriter } from "./queryWriter";

const MAX_RESULTS_PER_QUERY = 6;

export async function runCheapBotPipeline(
  post: Post,
  input: BotInput,
): Promise<PipelineOutcome> {
  const startMs = Date.now();
  const log = getTweetLog();

  const userMessage = buildUserMessage({
    post,
    tweetMedia: input.mediaResult.tweetMedia,
    quotedTweetMedia: input.mediaResult.quotedTweetMedia,
    authorNoteHistory: input.authorHistory,
    comments: input.comments,
  });

  // Stage 1: query writer
  const { queries } = await runQueryWriter(userMessage);
  log?.set("cheapBot.queries", queries);
  if (queries.length === 0) {
    logFinal(startMs);
    return { type: "no_correction", reason: "query writer returned no queries — post likely opinion or non-checkable" };
  }

  // Stage 2: searXNG fetch — one request per query, combined.
  const findings = await fetchAndFormatSearch(queries);
  log?.set("cheapBot.searchFindings", findings.slice(0, 4000));

  if (!findings.trim()) {
    logFinal(startMs);
    return { type: "no_correction", reason: "searXNG returned no results for any query" };
  }

  // Stage 3: writer
  const note = await runWriter(userMessage, findings);

  // Stage 4: note-needed judge (always on in cheap-bot — primary FP guard)
  const judge = await runNoteNeededJudge({
    postContext: userMessage,
    researcherFindings: findings,
    noteText: note.noteText,
    sources: note.sources,
  });
  if (!judge.noteNeeded) {
    logFinal(startMs);
    return { type: "no_correction", reason: judge.reasoning };
  }

  // Stage 5: source verifier (second FP guard — drops the note if cited URL doesn't back the claim)
  const verification = await verifySources({
    noteText: note.noteText,
    sources: note.sources,
    postContext: userMessage,
    researcherFindings: findings,
    turnNumber: 1,
  });

  logFinal(startMs);

  if (verification.accepted) {
    return { type: "note", noteText: note.noteText, sources: verification.good_sources, searchResults: findings };
  }
  return {
    type: "verification_failed",
    noteText: note.noteText,
    sources: note.sources,
    reason: verification.reasoning,
    searchResults: findings,
  };
}

async function fetchAndFormatSearch(queries: string[]): Promise<string> {
  const sections: string[] = [];
  for (const q of queries) {
    let results: SearxngResult[] = [];
    try {
      results = await fetchSearxngResults(q);
    } catch (err: any) {
      sections.push(`## Query: ${q}\n(error: ${err?.message ?? "unknown"})`);
      continue;
    }
    const top = results.slice(0, MAX_RESULTS_PER_QUERY);
    sections.push(`## Query: ${q}\n${formatSearxngResults(top)}`);
  }
  return sections.join("\n\n");
}

function logFinal(startMs: number): void {
  const log = getTweetLog();
  log?.set("cheapBot.totalDurationMs", Date.now() - startMs);
}
