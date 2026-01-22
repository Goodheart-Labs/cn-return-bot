/**
 * Bot Registry
 *
 * Aggregates all bots and provides selection utilities.
 */

import { Bot } from "./types";
import { opusMain } from "./opus-main";
import { opusScored } from "./opus-scored";
import { opusStrict } from "./opus-strict";

// Legacy bots (weight=0, kept for historical data)
import { geminiFlash } from "./legacy/gemini-flash";
import { multiSearch } from "./legacy/multi-search";
import { gemini3Flash } from "./legacy/gemini-3-flash";
import { deepseek } from "./legacy/deepseek";

// Register all bots here
export const bots: Bot[] = [
  // Active bots (weights total 100)
  opusMain,      // 55%
  opusScored,    // 30%
  opusStrict,    // 15%
  // Legacy bots (disabled)
  geminiFlash,
  multiSearch,
  gemini3Flash,
  deepseek,
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
