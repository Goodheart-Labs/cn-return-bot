/**
 * Simple Bot
 *
 * The pipeline runs three stages in a line: search, note writer, source
 * verifier. The search stage hands the work to one of several provider
 * helpers, picked by config.web_search. The choices are Anthropic native
 * search, Gemini native search, Grok native search, OpenAI native search,
 * Perplexity Sonar with its bundled search, and a Serper tool-calling loop.
 *
 * generateCandidates.ts puts the bot config on AsyncLocalStorage and starts
 * cost tracking before this runs, so there is nothing left to set up here.
 */

import { Bot, PipelineResult, outcomeToResult } from "./types";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runSimpleBotPipeline } from "../pipeline/simple-bot/orchestrator";

export const simpleBot: Bot = {
  id: "simple-bot",
  name: "Simple Bot",
  description: "Search → notewriter → verifier; multi-provider search step",
  async runPipeline(post): Promise<PipelineResult | null> {
    const input = await createBotInput(post, this.id);
    const outcome = await runSimpleBotPipeline(post, input);
    return outcomeToResult(post, this.id, outcome);
  },
};
