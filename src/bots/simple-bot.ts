/**
 * Simple Bot
 *
 * Linear three-stage pipeline: search → notewriter → source verifier. Search
 * step dispatches to one of several provider-specific helpers based on
 * config.web_search (Anthropic native, Gemini native, Grok native, OpenAI
 * native, Perplexity Sonar bundled, or a SearXNG tool-calling loop).
 *
 * Config is set on AsyncLocalStorage by generateCandidates.ts before this
 * runs; cost tracking is also already wrapped. Just runs the pipeline.
 */

import { Bot, PipelineResult, outcomeToResult } from "./types";
import { getBotConfig } from "../pipeline/utils/botConfig";
import { aggregateAndLogCosts } from "../pipeline/cost-tracking/costTracker";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runSimpleBotPipeline } from "../pipeline/simple-bot/orchestrator";

export const simpleBot: Bot = {
  id: "simple-bot",
  name: "Simple Bot",
  description: "Search → notewriter → verifier; multi-provider search step",
  async runPipeline(post): Promise<PipelineResult | null> {
    const config = getBotConfig();
    const input = await createBotInput(post, this.id);
    const outcome = await runSimpleBotPipeline(post, input);
    const result = outcomeToResult(post, this.id, outcome, config.scoreFilters);
    if (input.warnings.length) {
      result.warnings = [...(result.warnings ?? []), ...input.warnings];
    }
    result.cost = aggregateAndLogCosts()?.cost;
    return result;
  },
};
