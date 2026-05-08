/**
 * Simple Bot
 *
 * Linear three-stage pipeline: search → notewriter → source verifier. Search
 * step dispatches to one of several provider-specific helpers based on
 * config.web_search (Anthropic native, Gemini native, Grok native, OpenAI
 * native, Perplexity Sonar bundled, or a SearXNG tool-calling loop).
 */

import { Bot, PipelineResult, outcomeToResult } from "./types";
import { randomizeConfig, withBotConfig, getFullBotId } from "../pipeline/utils/botConfig";
import { withCostTracker, aggregateAndLogCosts } from "../pipeline/utils/costTracker";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runSimpleBotPipeline } from "../pipeline/simple-bot/orchestrator";
import { getTweetLog } from "../pipeline/utils/tweetLog";

export const simpleBot: Bot = {
  id: "simple-bot",
  name: "Simple Bot",
  description: "Search → notewriter → verifier; multi-provider search step",
  async runPipeline(post): Promise<PipelineResult | null> {
    const config = randomizeConfig(this.id);
    const fullBotId = getFullBotId(this.id, config);

    return withBotConfig(config, () => withCostTracker(async () => {
      const log = getTweetLog();
      log?.set("bot.id", fullBotId);
      log?.set("bot.name", this.id);
      log?.set("bot.config", config);
      const input = await createBotInput(post, "simple-bot");
      const outcome = await runSimpleBotPipeline(post, input);
      const result = outcomeToResult(post, fullBotId, outcome, config.scoreFilters);
      if (input.warnings.length) {
        result.warnings = [...(result.warnings ?? []), ...input.warnings];
      }
      result.cost = aggregateAndLogCosts()?.cost;
      return result;
    }));
  },
};
