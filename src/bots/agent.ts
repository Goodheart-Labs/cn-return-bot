/**
 * Agent Bot
 *
 * Single agentic call with tool calling.
 * Model and search mode determined by botConfig.
 */

import { Bot, PipelineResult } from "./types";
import { randomizeConfig, withBotConfig } from "../pipeline/utils/botConfig";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runToolCallingLoop } from "../pipeline/tool-calling/toolCallingLoop";

export const agentBot: Bot = {
  id: "agent",
  name: "Agent",
  description: "Agentic bot with tool calling",
  weight: 0,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    const config = randomizeConfig();

    return withBotConfig(config, async () => {
      const input = await createBotInput(post, content, "agent");
      const result = await runToolCallingLoop(post, content, input);
      if (input.warnings.length) {
        result.warnings = [...(result.warnings ?? []), ...input.warnings];
      }
      return result;
    });
  },
};
