/**
 * Bot Registry
 *
 * Aggregates all bots and provides selection utilities.
 */

import { Bot } from "./types";
import { opusMain } from "./opus-main";
import { opusConcise } from "./opus-concise";
import { opusResearch } from "./opus-research";
import { kimiK2 } from "./kimi-k2";
import { opus46 } from "./opus-4.6";
import { sonarPro } from "./sonar-pro";

// Legacy bots (weight=0, kept for historical data)
import { geminiFlash } from "./legacy/gemini-flash";
import { multiSearch } from "./legacy/multi-search";
import { gemini3Flash } from "./legacy/gemini-3-flash";
import { deepseek } from "./legacy/deepseek";
import { opusScored } from "./legacy/opus-scored";
import { opusStrict } from "./legacy/opus-strict";
import { opusMainLegacy } from "./legacy/opus-main";

// Register all bots here
export const bots: Bot[] = [
  // Active bots
  opusMain,      // 70%
  opusConcise,   // 15%
  opusResearch,  // 15%
  kimiK2,        // 0% (experimental)
  opus46,         // 0% (experimental)
  sonarPro,       // 0% (experimental)
  // Legacy bots (disabled)
  geminiFlash,
  multiSearch,
  gemini3Flash,
  deepseek,
  opusScored,
  opusStrict,
  opusMainLegacy,
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
