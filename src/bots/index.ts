/**
 * Bot Registry
 *
 * Aggregates all bots and provides selection utilities.
 */

import { Bot } from "./types";
import { opusMainLegacy } from "./legacy/opus-main";
import { opusMain } from "./opus-main";
import { opusMainNoSourceCheck } from "./opus-main-no-source-check";
import { opusDirect } from "./opus-direct";
import { opusDirectGrok } from "./opus-direct-grok";
import { opusMainV2Grok } from "./opus-main-v2-grok";

// Legacy bots (weight=0, kept for historical data)
import { opusResearch } from "./opus-research";
import { kimiK2 } from "./kimi-k2";
import { opus46 } from "./opus-4.6";
import { sonarPro } from "./sonar-pro";
import { opusVerified } from "./opus-verified";
import { opusConcise } from "./opus-concise";
import { geminiFlash } from "./legacy/gemini-flash";
import { multiSearch } from "./legacy/multi-search";
import { gemini3Flash } from "./legacy/gemini-3-flash";
import { deepseek } from "./legacy/deepseek";
import { opusScored } from "./legacy/opus-scored";
import { opusStrict } from "./legacy/opus-strict";

// Register all bots here
export const bots: Bot[] = [
  // Active bots
  opusMainLegacy,         // 40% — opus-main (original writeNote prompt)
  opusMain,               // 20% — opus-main-v2 (URL-aware char counting)
  opusMainNoSourceCheck,  // 20% — opus-main-v2 without source verification (A/B test)
  opusDirect,             //  7% — direct style (leads with facts, punchy)
  opusDirectGrok,  //  7% — direct style + Grok X search
  opusMainV2Grok,  //  6% — opus-main-v2 + Grok X search
  // Legacy bots (disabled)
  opusResearch,
  kimiK2,
  opus46,
  sonarPro,
  opusVerified,
  opusConcise,
  geminiFlash,
  multiSearch,
  gemini3Flash,
  deepseek,
  opusScored,
  opusStrict,
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
