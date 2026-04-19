/**
 * Multi-Agent Bot
 *
 * Three-stage pipeline: Researcher → Notewriter → Source Verifier.
 * Model determined by botConfig. Messages persist across turns.
 */

import { Bot, PipelineResult, outcomeToResult } from "./types";
import { randomizeConfig, withBotConfig, getFullBotId } from "../pipeline/utils/botConfig";
import { withCostTracker } from "../pipeline/utils/costTracker";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runMultiAgentPipeline } from "../pipeline/multi-agent/orchestrator";
import { getTweetLog } from "../pipeline/utils/tweetLog";

export const multiAgentBot: Bot = {
  id: "multi-agent",
  name: "Multi-Agent",
  description: "Researcher → Notewriter → Source Verifier pipeline",
  async runPipeline(post, content): Promise<PipelineResult | null> {
    const config = randomizeConfig();
    const fullBotId = getFullBotId(this.id, config);

    return withBotConfig(config, () => withCostTracker(async () => {
      getTweetLog()?.set("bot.id", fullBotId);
      const input = await createBotInput(post, content, "multi-agent");
      const outcome = await runMultiAgentPipeline(post, content, input);
      const result = outcomeToResult(post, fullBotId, outcome);
      if (input.warnings.length) {
        result.warnings = [...(result.warnings ?? []), ...input.warnings];
      }
      return result;
    }));
  },
};
