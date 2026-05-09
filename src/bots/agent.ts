/**
 * Agent Bot
 *
 * Single agentic call with tool calling. Config is set on AsyncLocalStorage
 * by generateCandidates.ts before this runs.
 */

import type { Post } from "../api/fetchEligiblePosts";
import { Bot, PipelineResult, PipelineOutcome, outcomeToResult } from "./types";
import type { BotInput } from "../pipeline/input/createBotInput";
import { getBotConfig } from "../pipeline/utils/botConfig";
import { aggregateAndLogCosts } from "../pipeline/cost-tracking/costTracker";
import { createBotInput } from "../pipeline/input/createBotInput";
import { getTweetLog } from "../pipeline/utils/tweetLog";
import { buildToolList } from "../pipeline/tool-calling/tools";
import { initAgentState, addUserMessage, runAgentTurn, type AgentDef } from "../pipeline/tool-calling/agentLoop";
import { buildSystemPrompt, buildUserMessage } from "../pipeline/input/prompt";
import { evaluateAndPickBest } from "../pipeline/score/noteEvaluation";

const MAX_ITERATIONS = 50;

async function runAgent(post: Post, input: BotInput): Promise<PipelineOutcome> {
  const config = getBotConfig();
  const log = getTweetLog();

  const def: AgentDef = {
    name: "agent",
    description: "Single-turn fact-checking agent",
    systemPrompt: buildSystemPrompt(config),
    tools: buildToolList(),
    model: config.model,
  };

  const userMessage = buildUserMessage({
    post,
    tweetMedia: input.mediaResult.tweetMedia,
    quotedTweetMedia: input.mediaResult.quotedTweetMedia,
    authorNoteHistory: input.authorHistory,
    comments: input.comments,
  });

  log?.set("agent.config", config);

  const state = initAgentState(def);
  addUserMessage(state, userMessage);
  const result = await runAgentTurn(state, "agent.messages", MAX_ITERATIONS);

  if (result.terminalTool === "propose_notes") {
    const { selected, evalResults } = await evaluateAndPickBest(post.id, result.args.notes ?? []);
    log?.set("note.eval_scores", evalResults.map((r) => ({ score: r.evalScore, error: r.error })));
    log?.set("note.eval_score", selected.evalScore);
    return { type: "note", noteText: selected.noteText, sources: selected.sources, evalScore: selected.evalScore };
  }

  if (result.terminalTool === "no_correction_needed" || result.terminalTool === "text_response") {
    return { type: "no_correction", reason: result.args.reason ?? result.args.content ?? "No correction needed" };
  }

  return { type: "error", error: result.args.reason ?? `Loop exhausted after ${MAX_ITERATIONS} iterations` };
}

export const agentBot: Bot = {
  id: "agent",
  name: "Agent",
  description: "Agentic bot with tool calling",
  async runPipeline(post): Promise<PipelineResult | null> {
    const config = getBotConfig();
    const input = await createBotInput(post, this.id);
    const outcome = await runAgent(post, input);
    const result = outcomeToResult(post, this.id, outcome, config.scoreFilters);
    if (input.warnings.length) {
      result.warnings = [...(result.warnings ?? []), ...input.warnings];
    }
    result.cost = aggregateAndLogCosts()?.cost;
    return result;
  },
};
