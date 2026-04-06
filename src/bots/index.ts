/**
 * Bot Registry
 *
 * Aggregates all bots and provides selection utilities.
 */

import { Bot } from "./types";
import { opusMain } from "./opus-main";
import { opusMainV2 } from "./opus-main-v2";
import { opusMainNoSourceCheck } from "./opus-main-no-source-check";
import { opusDirect } from "./opus-direct";
import { opusDirectGrok } from "./opus-direct-grok";
import { opusMainV2Grok } from "./opus-main-v2-grok";
import { opusMultiSource } from "./opus-multi-source";
import { opusBridging } from "./opus-bridging";
import { agentBot } from "./agent";
import { multiAgentBot } from "./multi-agent";

// Legacy bots (weight=0, kept for historical data)
import { opusResearch } from "./opus-research";
import { kimiK2 } from "./kimi-k2";
import { opus46 } from "./opus-4.6";
import { sonarPro } from "./sonar-pro";
import { opusVerified } from "./opus-verified";
import { opusConcise } from "./opus-concise";

// =============================================================================
// RETIRED BOTS
// To recover: git show <commit>:src/bots/legacy/<filename>.ts
//
//   bot-id         file                 last commit  notes
//   opus-scored    opus-scored.ts       0289eae      LLM-scored variant, superseded
//   opus-strict    opus-strict.ts       0289eae      strict-threshold variant, superseded
//   gemini-flash   gemini-flash.ts      80841a5      Gemini 1.5 Flash
//   gemini-3-flash gemini-3-flash.ts    80841a5      Gemini 2.0 Flash
//   multi-search   multi-search.ts      80841a5      multi-source search variant
//   deepseek       deepseek.ts          80841a5      DeepSeek model variant
//
// ORPHANED PIPELINE COMPONENTS (only used by retired bots, safe to delete):
//   src/pipeline/multiSourceSearch.ts   — only used by multi-search
//   src/pipeline/predictionScores.ts    — post-submit predictor, no longer called
// =============================================================================

// Register all bots here
const bots: Bot[] = [
  // Active bots
  opusMain,
  opusMainV2,
  opusMainNoSourceCheck,
  opusDirect,
  opusDirectGrok,
  opusMainV2Grok,
  opusMultiSource,
  opusBridging,
  agentBot,
  multiAgentBot,
  // Legacy bots (disabled)
  opusResearch,
  kimiK2,
  opus46,
  sonarPro,
  opusVerified,
  opusConcise,
];

/**
 * Get all enabled bots (currently all bots are enabled)
 */
export function getEnabledBots(): Bot[] {
  return bots;
}

/**
 * Select a random bot based on weights
 * Bots with higher weights are more likely to be selected
 */
export function selectRandomBot(): Bot {
  const enabledBots = getEnabledBots();

  if (enabledBots.length === 0) {
    throw new Error("No enabled bots configured");
  }

  // Calculate total weight
  const totalWeight = enabledBots.reduce((sum, bot) => sum + bot.weight, 0);

  // Generate random number between 0 and totalWeight
  let random = Math.random() * totalWeight;

  // Select bot based on weight
  for (const bot of enabledBots) {
    random -= bot.weight;
    if (random <= 0) {
      return bot;
    }
  }

  // Fallback to first enabled bot (shouldn't happen due to length check above)
  return enabledBots[0]!;
}

/**
 * Get bot probabilities for logging
 */
export function getBotProbabilities(): { id: string; probability: number }[] {
  const enabledBots = getEnabledBots();
  const totalWeight = enabledBots.reduce((sum, bot) => sum + bot.weight, 0);

  return enabledBots.map((bot) => ({
    id: bot.id,
    probability: (bot.weight / totalWeight) * 100,
  }));
}

/**
 * Get a bot by ID
 */
export function getBotById(id: string): Bot | undefined {
  return bots.find((bot) => bot.id === id);
}

// Re-export types
export type { Bot, PipelineResult, PostContent } from "./types";
