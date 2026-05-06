/**
 * Multi-Agent Bot
 *
 * Three-stage pipeline: Researcher → Notewriter → Source Verifier.
 * Model determined by botConfig. Messages persist across turns.
 */

import { Bot, PipelineResult, outcomeToResult } from "./types";
import { randomizeConfig, withBotConfig, getFullBotId } from "../pipeline/utils/botConfig";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runMultiAgentPipeline } from "../pipeline/multi-agent/orchestrator";
import { getTweetLog } from "../pipeline/utils/tweetLog";

export const multiAgentBot: Bot = {
  id: "multi-agent",
  name: "Multi-Agent",
  description: "Researcher → Notewriter → Source Verifier pipeline",
  async runPipeline(post): Promise<PipelineResult | null> {
    const config = randomizeConfig(this.id);
    const fullBotId = getFullBotId(this.id, config);

    return withBotConfig(config, async () => {
      const log = getTweetLog();
      log?.set("bot.id", fullBotId);
      log?.set("bot.name", this.id);
      log?.set("bot.config", config);
      const input = await createBotInput(post, "multi-agent");
      const outcome = await runMultiAgentPipeline(post, input);
      const result = outcomeToResult(post, fullBotId, outcome, config.scoreFilters);
      if (input.warnings.length) {
        result.warnings = [...(result.warnings ?? []), ...input.warnings];
      }
      return result;
    });
  },
};
