/**
 * Agent Bot
 *
 * Single agentic call with tool calling. Config is set on AsyncLocalStorage
 * by generateCandidates.ts before this runs.
 */

import type { Post } from "../api/fetchEligiblePosts";
import { Bot, PipelineResult, PipelineOutcome, outcomeToResult } from "./types";
import type { BotInput } from "../pipeline/input/createBotInput";
import { getBotConfig } from "../pipeline/ab-testing/botConfig";
import { createBotInput } from "../pipeline/input/createBotInput";
import { getTweetLog } from "../pipeline/utils/tweetLog";
import { buildToolList } from "../pipeline/tool-calling/tools";
import { initAgentState, addUserMessage, runAgentTurn, type AgentDef } from "../pipeline/tool-calling/agentLoop";
import { buildSystemPrompt } from "../pipeline/input/prompt";
import { buildUserMessageFromInput } from "../pipeline/prompts/input/userMessage";
import { evaluateAndPickBest } from "../pipeline/score/noteEvaluation";
import { AgentToolError, PipelineExhaustedError } from "../pipeline/utils/errors";

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

  const userMessage = buildUserMessageFromInput(post, input);

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

  if (result.args.reason) {
    throw new AgentToolError(result.args.reason);
  }
  throw new PipelineExhaustedError(`Loop exhausted after ${MAX_ITERATIONS} iterations`);
}

export const agentBot: Bot = {
  id: "agent",
  name: "Agent",
  description: "Agentic bot with tool calling",
  async runPipeline(post): Promise<PipelineResult | null> {
    const input = await createBotInput(post, this.id);
    const outcome = await runAgent(post, input);
    const result = outcomeToResult(post, this.id, outcome);
    if (input.warnings.length) {
      result.warnings = [...(result.warnings ?? []), ...input.warnings];
    }
    return result;
  },
};
