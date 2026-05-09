/**
 * Bot Registry
 *
 * Aggregates all bots and exposes lookup-by-id. Bot selection is driven by
 * `BOT_TEST` in src/pipeline/ab-testing/abTests.ts (no static weight table here).
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
import { simpleBot } from "./simple-bot";

// Legacy bots (kept for historical data; selection weight is 0 in BOT_TEST)
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

const ALL_BOTS: Bot[] = [
  agentBot, multiAgentBot, simpleBot,
  opusMain, opusMainV2, opusMainNoSourceCheck,
  opusDirect, opusDirectGrok, opusMainV2Grok,
  opusMultiSource, opusBridging,
  opusResearch, kimiK2, opus46, sonarPro, opusVerified, opusConcise,
];

export function getEnabledBots(): Bot[] {
  return ALL_BOTS;
}

export function getBotById(id: string): Bot | undefined {
  return ALL_BOTS.find((bot) => bot.id === id);
}

// Re-export types
export type { Bot, PipelineResult, PostContent } from "./types";
