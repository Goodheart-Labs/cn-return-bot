/**
 * Multi-Agent Bot
 *
 * Three-stage pipeline: Researcher → Notewriter → Source Verifier. Messages
 * persist across turns. Config is set on AsyncLocalStorage by
 * generateCandidates.ts before this runs.
 */

import { Bot, PipelineResult, outcomeToResult } from "./types";
import { getBotConfig } from "../pipeline/ab-testing/botConfig";
import { aggregateAndLogCosts } from "../pipeline/cost-tracking/costTracker";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runMultiAgentPipeline } from "../pipeline/multi-agent/orchestrator";

export const multiAgentBot: Bot = {
  id: "multi-agent",
  name: "Multi-Agent",
  description: "Researcher → Notewriter → Source Verifier pipeline",
  async runPipeline(post): Promise<PipelineResult | null> {
    const config = getBotConfig();
    const input = await createBotInput(post, this.id);
    const outcome = await runMultiAgentPipeline(post, input);
    const result = outcomeToResult(post, this.id, outcome, config.scoreFilters);
    if (input.warnings.length) {
      result.warnings = [...(result.warnings ?? []), ...input.warnings];
    }
    result.cost = aggregateAndLogCosts()?.cost;
    return result;
  },
};
