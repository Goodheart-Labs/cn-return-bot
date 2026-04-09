/**
 * Tool-Calling Loop (Single-Agent Pipeline)
 *
 * Runs a single agent turn with fact-checking tools. When propose_notes is
 * called, evaluates each candidate and picks the best.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineResult, PostContent } from "../../bots/types";
import type { GeminiMediaResult } from "../media/mediaAnalysisGemini";
import type { AuthorNoteHistory } from "../input/authorHistory";
import type { TokenCost } from "../utils/pricing";
import { getBotConfig } from "../utils/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { emptyTokenCost } from "../utils/pricing";
import { buildToolList } from "./tools";
import { initAgentState, addUserMessage, runAgentTurn, type AgentDef } from "./agentLoop";
import { SYSTEM_PROMPT, buildUserMessage } from "../input/prompt";
import { evaluateAndPickBest } from "../score/noteEvaluation";
import { buildNoteResult, buildEmptyResult } from "../utils/pipelineResult";

const MAX_ITERATIONS = 50;

export async function runToolCallingLoop(
  post: Post,
  content: PostContent,
  mediaResult: GeminiMediaResult,
  authorHistory?: AuthorNoteHistory,
  mediaCost?: TokenCost,
  comments?: string,
): Promise<PipelineResult> {
  const config = getBotConfig();
  const log = getTweetLog();

  // Build agent definition
  const def: AgentDef = {
    name: "agent",
    description: "Single-turn fact-checking agent",
    systemPrompt: SYSTEM_PROMPT,
    tools: buildToolList(),
    terminalTools: ["propose_notes", "no_correction_needed"],
    model: config.model,
  };

  // Build user message
  const quotedRef = post.referenced_tweets?.find((rt) => rt.type === "quoted");
  const quotedPostText = quotedRef && post.referenced_tweet_data
    ? post.referenced_tweet_data.text
    : undefined;

  const now = new Date();
  const userMessage = buildUserMessage({
    tweetText: content.text,
    tweetId: post.id,
    tweetDate: post.created_at,
    quotedPostText,
    tweetMedia: mediaResult.tweetMedia,
    quotedTweetMedia: mediaResult.quotedTweetMedia,
    authorName: post.author_name,
    authorDescription: post.author_description,
    authorFollowers: post.author_followers,
    authorTweetCount: post.author_tweet_count,
    authorNoteHistory: authorHistory,
    comments,
    currentDate: now.toISOString().split("T")[0]!,
    currentTime: now.toISOString().split("T")[1]!.slice(0, 5),
  });

  // Log initial state
  log?.set("agent.config", config);
  log?.set("inputs.author", {
    name: post.author_name,
    description: post.author_description,
    followers: post.author_followers,
    tweetCount: post.author_tweet_count,
    noteHistory: authorHistory ?? null,
  });

  // Run the agent
  const state = initAgentState(def);
  addUserMessage(state, userMessage);
  const result = await runAgentTurn(state, "agent.messages", MAX_ITERATIONS);

  // Log costs
  const costs = {
    messages: result.iterationCosts,
    media: mediaCost ?? emptyTokenCost(),
    ...result.cost,
  };
  if (mediaCost) costs.cost += mediaCost.cost;
  log?.set("agent.costs", costs);
  log?.set("agent.iterations", result.iterations);

  const searchResults = result.searchOutputs.join("\n\n");
  const common = { post, botId: "agent", text: content.text, searchResults };

  // Handle propose_notes: evaluate and pick best
  if (result.terminalTool === "propose_notes") {
    const notes: Array<{ note_text: string; sources: string[] }> = result.args.notes ?? [];
    const { selected, evalResults } = await evaluateAndPickBest(post.id, notes);

    log?.set("note.eval_scores", evalResults.map((r) => ({ score: r.evalScore, error: r.error })));
    log?.set("note.eval_score", selected.evalScore);

    return buildNoteResult({ ...common, lastStage: "agent_complete", ...selected });
  }

  if (result.terminalTool === "no_correction_needed") {
    return buildEmptyResult({ ...common, lastStage: "agent_complete" });
  }

  return buildEmptyResult({
    ...common,
    lastStage: "agent_exhausted",
    error: `Tool-calling loop exhausted after ${MAX_ITERATIONS} iterations`,
  });
}
