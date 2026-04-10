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

  const base: PipelineResult = {
    post,
    botId: "agent",
    lastStage: "agent_complete",
    searchContextResult: { text: content.text, searchResults: "" },
    noteResult: { note: "", url: "", status: "NO MISSING CONTEXT" },
  };

  if (result.terminalTool === "propose_notes") {
    const { selected, evalResults } = await evaluateAndPickBest(post.id, result.args.notes ?? []);
    log?.set("note.eval_scores", evalResults.map((r) => ({ score: r.evalScore, error: r.error })));
    log?.set("note.eval_score", selected.evalScore);
    return {
      ...base,
      searchContextResult: { ...base.searchContextResult, citations: selected.sources },
      noteResult: { note: selected.noteText, url: selected.allUrls, status: "CORRECTION WITH TRUSTWORTHY CITATION" },
      checkResult: "YES",
    };
  }

  if (result.terminalTool !== "no_correction_needed") {
    return { ...base, lastStage: "agent_exhausted", error: result.args.reason ?? `Loop exhausted after ${MAX_ITERATIONS} iterations` };
  }

  return base;
}
