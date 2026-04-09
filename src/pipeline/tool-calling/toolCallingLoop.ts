/**
 * Tool-Calling Loop (Single-Agent Pipeline)
 *
 * Runs a single agent turn with fact-checking tools. When propose_notes is
 * called, evaluates each candidate and picks the best.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineResult, PostContent } from "../../bots/types";
import type { BotInput } from "../input/createBotInput";
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
  input: BotInput,
): Promise<PipelineResult> {
  const config = getBotConfig();
  const log = getTweetLog();

  const def: AgentDef = {
    name: "agent",
    description: "Single-turn fact-checking agent",
    systemPrompt: SYSTEM_PROMPT,
    tools: buildToolList(),
    terminalTools: ["propose_notes", "no_correction_needed"],
    model: config.model,
  };

  const userMessage = buildUserMessage({
    post,
    tweetText: content.text,
    tweetMedia: input.mediaResult.tweetMedia,
    quotedTweetMedia: input.mediaResult.quotedTweetMedia,
    authorNoteHistory: input.authorHistory,
    comments: input.comments,
  });

  log?.set("agent.config", config);

  const state = initAgentState(def);
  addUserMessage(state, userMessage);
  const result = await runAgentTurn(state, "agent.messages", MAX_ITERATIONS);

  const costs = {
    messages: result.iterationCosts,
    media: input.mediaCost ?? emptyTokenCost(),
    ...result.cost,
  };
  if (input.mediaCost) costs.cost += input.mediaCost.cost;
  log?.set("agent.costs", costs);
  log?.set("agent.iterations", result.iterations);

  const searchResults = result.searchOutputs.join("\n\n");
  const common = { post, botId: "agent", text: content.text, searchResults };

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
