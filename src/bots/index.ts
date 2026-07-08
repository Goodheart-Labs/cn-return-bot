/**
 * Bot Registry
 *
 * Aggregates all bots and exposes lookup-by-id. Bot selection is driven by
 * `BOT_TEST` in src/pipeline/ab-testing/abTests.ts (no static weight table here).
 */

import { Bot } from "./types";
import { simpleBot } from "./simple-bot";

// =============================================================================
// RETIRED BOTS — recoverable via `git show <commit>:src/bots/<file>.ts`.
//
//   bot-id         file                 last commit  notes
//   cheap-bot      cheap-bot.ts         2885cc0      DeepSeek 5-stage hill-climb target; retired. Its query
//                                                    writer + search analyzer live on under pipeline/prefilter/.
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
//   opus-main, opus-main-v2, opus-main-no-source-check, opus-direct,
//   opus-direct-grok, opus-main-v2-grok, opus-multi-source, opus-bridging,
//   opus-research, agent, multi-agent — all weight-0; retired when the prompts/
//   folder landed. Took their note-writer / search / verify-single helpers with
//   them (write/writeNote{Legacy,Direct,Bridging,MultiSource}, search/*,
//   verify/sourceVerification, multi-agent/*, input/prompt, tool-calling tool
//   schemas + buildToolList).
// =============================================================================

const ALL_BOTS: Bot[] = [simpleBot];

export function getEnabledBots(): Bot[] {
  return ALL_BOTS;
}

export function getBotById(id: string): Bot | undefined {
  return ALL_BOTS.find((bot) => bot.id === id);
}

// Re-export types
export type { Bot, PipelineResult, PostContent } from "./types";
