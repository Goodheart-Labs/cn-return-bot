/**
 * cheap-bot
 *
 * 5-stage hill-climbing target: query writer → searXNG → note writer →
 * note-needed judge → source verifier. All LLM stages run on DeepSeek v4 Flash.
 * Dedicated to iteration against datasets/big_eval/splits/val.csv — simple-bot
 * stays untouched and serves production traffic.
 */

import { Bot, PipelineResult, outcomeToResult } from "./types";
import { getBotConfig } from "../pipeline/ab-testing/botConfig";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runCheapBotPipeline } from "../pipeline/cheap-bot/orchestrator";

export const cheapBot: Bot = {
  id: "cheap-bot",
  name: "Cheap Bot",
  description: "DeepSeek 5-stage: query writer → searXNG → write → note-needed judge → verify",
  async runPipeline(post): Promise<PipelineResult | null> {
    const config = getBotConfig();
    const input = await createBotInput(post, this.id);
    const outcome = await runCheapBotPipeline(post, input);
    const result = outcomeToResult(post, this.id, outcome, config.scoreFilters);
    if (input.warnings.length) {
      result.warnings = [...(result.warnings ?? []), ...input.warnings];
    }
    return result;
  },
};
