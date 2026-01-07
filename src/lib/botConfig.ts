/**
 * Bot Configuration System
 *
 * This file defines the configuration interface for different bots
 * and provides weighted random selection for A/B testing in production.
 */

export interface BotConfig {
  /** Unique identifier for the bot */
  id: string;

  /** Human-readable name for display */
  name: string;

  /** Description of what makes this bot different */
  description: string;

  /** Model to use for note writing */
  noteModel: string;

  /** Model to use for search (if different from note model) */
  searchModel?: string;

  /** Whether this bot is enabled */
  enabled: boolean;

  /** Weight for random selection (higher = more likely to be chosen) */
  weight: number;

  /**
   * Search strategy to use:
   * - "default": Standard Perplexity search
   * - "multi-source": Extract topic first, then search Perplexity + Google + Exa + X
   */
  searchStrategy: "default" | "multi-source";
}

/**
 * All available bot configurations
 */
export const BOT_CONFIGS: BotConfig[] = [
  {
    id: "opus-main",
    name: "Opus 4.5 (Main)",
    description: "Primary bot using Claude Opus 4.5 for highest quality notes",
    noteModel: "anthropic/claude-opus-4-5-20251101",
    enabled: true,
    weight: 80, // 80% of traffic
    searchStrategy: "default",
  },
  {
    id: "gemini-flash",
    name: "Gemini Flash (Cheap)",
    description: "Cost-effective bot using Gemini 2.0 Flash - fast and cheap",
    noteModel: "google/gemini-2.0-flash-001",
    enabled: true,
    weight: 10, // 10% of traffic
    searchStrategy: "default",
  },
  {
    id: "multi-search",
    name: "Multi-Source Search",
    description:
      "Extracts topic first, then searches Perplexity + Google + Exa + X for comprehensive context",
    noteModel: "anthropic/claude-opus-4-5-20251101",
    enabled: true,
    weight: 10, // 10% of traffic
    searchStrategy: "multi-source",
  },
];

/**
 * Get all enabled bot configurations
 */
export function getEnabledBots(): BotConfig[] {
  return BOT_CONFIGS.filter((bot) => bot.enabled);
}

/**
 * Select a random bot based on weights
 * Bots with higher weights are more likely to be selected
 */
export function selectRandomBot(): BotConfig {
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

  // Fallback to first enabled bot (shouldn't happen)
  return enabledBots[0];
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
 * Get a bot config by ID
 */
export function getBotById(id: string): BotConfig | undefined {
  return BOT_CONFIGS.find((bot) => bot.id === id);
}
