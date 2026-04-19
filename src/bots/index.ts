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

// =============================================================================
// BOT WEIGHTS — edit this table to change what runs in production
// =============================================================================

const BOT_WEIGHTS: [Bot, number][] = [
  [agentBot,                    0],
  [multiAgentBot,              30],
  [opusMain,                   26],
  [opusMainV2,                 11],
  [opusMainNoSourceCheck,       0],
  [opusDirect,                 11],
  [opusDirectGrok,              0],
  [opusMainV2Grok,             11],
  [opusMultiSource,             0],
  [opusBridging,               11],
  [opusResearch,                0],
  [kimiK2,                      0],
  [opus46,                      0],
  [sonarPro,                    0],
  [opusVerified,                0],
  [opusConcise,                 0],
];

// =============================================================================

const ALL_BOTS = BOT_WEIGHTS.map(([bot]) => bot);

export function getEnabledBots(): Bot[] {
  return ALL_BOTS;
}

export function selectRandomBot(): Bot {
  const totalWeight = BOT_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight === 0) throw new Error("No bots have positive weights");

  let r = Math.random() * totalWeight;
  for (const [bot, weight] of BOT_WEIGHTS) {
    r -= weight;
    if (r <= 0) return bot;
  }
  return BOT_WEIGHTS[BOT_WEIGHTS.length - 1]![0];
}

export function getBotProbabilities(): { id: string; probability: number }[] {
  const totalWeight = BOT_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  return BOT_WEIGHTS.map(([bot, weight]) => ({
    id: bot.id,
    probability: totalWeight > 0 ? (weight / totalWeight) * 100 : 0,
  }));
}

export function getBotById(id: string): Bot | undefined {
  return ALL_BOTS.find((bot) => bot.id === id);
}

// Re-export types
export type { Bot, PipelineResult, PostContent } from "./types";
