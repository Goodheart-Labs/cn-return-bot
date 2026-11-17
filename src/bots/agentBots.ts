/**
 * Agent Bots (GOO-734)
 *
 * The agent note writer of src/agent-notes/ as two X bots, one on GPT-6.1
 * Terra and one on Sonnet 5.5, both at medium effort. One agent researches the
 * tweet with our Serper search and page fetch and writes the note itself, so
 * there are no separate search, writer and verifier steps. Its note then goes
 * through the same gates as the pipeline's: the materiality judge where the
 * A/B test turns it on, and X's evaluate_note.
 *
 * The agent reads the input the Claude note writer gets for a tweet, except
 * that Gemini describes the tweet's images, because the harness never sends
 * an image. The prompt's A/B picks (claude_x_taste, claude_x_research_nudge)
 * are drawn with the other tests of the run.
 */

import { emptyRunRecord, runJob, type RunRecord } from "../agent-notes/harness";
import type { HarnessModel } from "../agent-notes/model";
import { trackLlmCall } from "../pipeline/cost-tracking/costTracker";
import { SERPER_COST_PER_SEARCH } from "../pipeline/cost-tracking/pricing";
import { buildClaudeTweetInput } from "../pipeline/input/claudeTweetInput";
import { getLoggedBotIdentity, getTweetLog } from "../pipeline/utils/tweetLog";
import { outcomeToResult, type Bot, type PipelineOutcome } from "./types";

const EFFORT = "medium";
/** OpenAI's standard tier for GPT. An X run has a deadline, and flex may wait
 *  long for a free machine. */
const TIER = "default";

/** Every request and the searches go into the run's cost, so they count
 *  toward the X bot's daily spend cap. */
function trackCosts(record: RunRecord) {
  for (const request of record.requests) {
    trackLlmCall({
      name: `agent.${request.agent.replace(/\s+/g, "_")}.turn${request.turn}`,
      input_tokens: request.inputTokens,
      output_tokens: request.outputTokens,
      cost: request.costUsd,
      cached_tokens: request.cachedTokens,
      cache_write_tokens: request.cacheWriteTokens,
      tools: [],
    });
  }
  trackLlmCall({ name: "agent.search", input_tokens: 0, output_tokens: 0, cost: record.web.searches * SERPER_COST_PER_SEARCH, tools: [] });
}

/** The note keeps its links where the agent put them, so it goes in whole and
 *  no source list is appended. The agent's reasoning stands in for the
 *  research findings that the materiality judge reads. */
function outcomeOf(record: RunRecord): PipelineOutcome {
  const answer = record.xAnswer;
  if (!answer) throw new Error("The agent stopped without answering the tweet");
  return answer.type === "note"
    ? { type: "note", noteText: answer.note, sources: [], searchResults: answer.reasoning }
    : { type: "no_correction", reason: answer.reason };
}

function agentBot(id: string, model: HarnessModel, name: string): Bot {
  return {
    id,
    name,
    description: `${name} at ${EFFORT} effort: one agent researches with Serper and our page fetch and writes the note`,
    async runPipeline(post) {
      const input = await buildClaudeTweetInput(post, { describeImages: true, authorHistory: true });
      const picks = getLoggedBotIdentity(id).picks ?? {};
      const record = emptyRunRecord();
      try {
        await runJob({ kind: "tweet", input, picks }, { model, effort: EFFORT, tier: TIER, provider: "openrouter" }, record);
      } finally {
        trackCosts(record);
        getTweetLog()?.set("agent", { input, answer: record.xAnswer, web: record.web, requests: record.requests, failedRequests: record.failedRequests, trajectory: record.trajectory });
      }
      return outcomeToResult(post, id, outcomeOf(record));
    },
  };
}

export const gptAgentBot = agentBot("gpt61terra-agent", "gpt-6.1-terra", "GPT-6.1 Terra agent");
export const sonnetAgentBot = agentBot("sonnet55-agent", "sonnet-5.5", "Sonnet 5.5 agent");
