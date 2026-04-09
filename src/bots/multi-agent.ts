/**
 * Multi-Agent Bot
 *
 * Three-stage pipeline: Researcher → Notewriter → Source Verifier.
 * Model determined by botConfig. Messages persist across turns.
 */

import { Bot, PipelineResult } from "./types";
import { randomizeConfig, withBotConfig } from "../pipeline/utils/botConfig";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runMultiAgentPipeline } from "../pipeline/multi-agent/orchestrator";

export const multiAgentBot: Bot = {
  id: "multi-agent",
  name: "Multi-Agent",
  description: "Researcher → Notewriter → Source Verifier pipeline",
  weight: 25,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    const config = randomizeConfig();

    return withBotConfig(config, async () => {
      const input = await createBotInput(post, content, config, "multi-agent");
      const result = await runMultiAgentPipeline(
        post, content, config, input.mediaResult,
        input.authorHistory, input.mediaCost, input.comments,
      );
      if (input.warnings.length) {
        result.warnings = [...(result.warnings ?? []), ...input.warnings];
      }
      return result;
    });
  },
};
