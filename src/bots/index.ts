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
import { opusResearch } from "./opus-research";
import { agentBot } from "./agent";
import { multiAgentBot } from "./multi-agent";
import { simpleBot } from "./simple-bot";
import { cheapBot } from "./cheap-bot";

// =============================================================================
// RETIRED BOTS — recoverable via `git show <commit>:src/bots/<file>.ts`.
//
//   bot-id         file                 last commit  notes
//   opus-4.6       opus-4.6.ts          a698e34      Opus 4.6 baseline, superseded
//   kimi-k2        kimi-k2.ts           a698e34      Kimi K2 variant
//   sonar-pro      sonar-pro.ts         a698e34      legacy Perplexity Sonar bot
//   opus-concise   opus-concise.ts      a698e34      concise-prompt variant
//   opus-verified  opus-verified.ts     a698e34      pre-verifier variant
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
  agentBot, multiAgentBot, simpleBot, cheapBot,
  opusMain, opusMainV2, opusMainNoSourceCheck,
  opusDirect, opusDirectGrok, opusMainV2Grok,
  opusMultiSource, opusBridging, opusResearch,
];

export function getEnabledBots(): Bot[] {
  return ALL_BOTS;
}

export function getBotById(id: string): Bot | undefined {
  return ALL_BOTS.find((bot) => bot.id === id);
}

// Re-export types
export type { Bot, PipelineResult, PostContent } from "./types";
