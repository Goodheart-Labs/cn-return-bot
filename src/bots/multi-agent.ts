/**
 * Multi-Agent Bot
 *
 * Three-stage pipeline: Researcher → Notewriter → Source Verifier.
 * Model determined by botConfig. Messages persist across turns.
 */

import { Bot, PipelineResult, outcomeToResult } from "./types";
import { randomizeConfig, withBotConfig } from "../pipeline/utils/botConfig";
import { withCostTracker } from "../pipeline/utils/costTracker";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runMultiAgentPipeline } from "../pipeline/multi-agent/orchestrator";

export const multiAgentBot: Bot = {
  id: "multi-agent",
  name: "Multi-Agent",
  description: "Researcher → Notewriter → Source Verifier pipeline",
  weight: 35,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    const config = randomizeConfig();

    return withBotConfig(config, () => withCostTracker(async () => {
      const input = await createBotInput(post, content, "multi-agent");
      const outcome = await runMultiAgentPipeline(post, content, input);
      const result = outcomeToResult(post, this.id, outcome);
      if (input.warnings.length) {
        result.warnings = [...(result.warnings ?? []), ...input.warnings];
      }
      return result;
    }));
  },
};
