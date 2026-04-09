/**
 * Agent Bot
 *
 * Single agentic call with tool calling.
 * Model and search mode determined by agentConfig.
 */

import { Bot, PipelineResult } from "./types";
import { randomizeConfig, withBotConfig } from "../pipeline/utils/botConfig";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runToolCallingLoop } from "../pipeline/agent/toolCallingLoop";

export const agentBot: Bot = {
  id: "agent",
  name: "Agent",
  description: "Agentic bot with tool calling",
  weight: 0,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    const config = randomizeConfig();

    return withBotConfig(config, async () => {
      const input = await createBotInput(post, content, config, "agent");
      const result = await runToolCallingLoop(
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
