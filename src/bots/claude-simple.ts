/**
 * Claude Simple Bot
 *
 * Linear three-stage pipeline: native web_search → notewriter → source verifier.
 * Mirrors opus-main's shape but reuses the richer multi-agent ingredients
 * (buildUserMessage, native Claude web_search, shared source verifier).
 */

import { Bot, PipelineResult, outcomeToResult } from "./types";
import { randomizeConfig, withBotConfig, getFullBotId } from "../pipeline/utils/botConfig";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runClaudeSimplePipeline } from "../pipeline/claude-simple/orchestrator";
import { getTweetLog } from "../pipeline/utils/tweetLog";

export const claudeSimpleBot: Bot = {
  id: "claude-simple",
  name: "Claude Simple",
  description: "Search → notewriter → verifier with native Claude web_search",
  async runPipeline(post): Promise<PipelineResult | null> {
    const config = randomizeConfig(this.id);
    const fullBotId = getFullBotId(this.id, config);

    return withBotConfig(config, async () => {
      const log = getTweetLog();
      log?.set("bot.id", fullBotId);
      log?.set("bot.name", this.id);
      log?.set("bot.config", config);
      const input = await createBotInput(post, "claude-simple");
      const outcome = await runClaudeSimplePipeline(post, input);
      const result = outcomeToResult(post, fullBotId, outcome, config.scoreFilters);
      if (input.warnings.length) {
        result.warnings = [...(result.warnings ?? []), ...input.warnings];
      }
      return result;
    });
  },
};
