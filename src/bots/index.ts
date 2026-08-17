/**
 * Bot Registry
 *
 * Collects every bot and lets a caller look one up by id. Which bot actually
 * runs is decided by `BOT_TEST` in src/pipeline/ab-testing/abTestsData.ts.
 * There is no static weight table in this file.
 */

import { Bot } from "./types";
import { simpleBot } from "./simple-bot";
import { cheapBot } from "./cheap-bot";

// Retired bots. Each file can be recovered with
// `git show <commit>:src/bots/<file>.ts`.
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
// These bots were retired together when the prompts/ folder landed: opus-main,
// opus-main-v2, opus-main-no-source-check, opus-direct, opus-direct-grok,
// opus-main-v2-grok, opus-multi-source, opus-bridging, opus-research, agent
// and multi-agent. All of them ran at weight 0 by then. Deleting them also
// deleted the helpers that only they used. Those were the note writers
// write/writeNoteLegacy, write/writeNoteDirect, write/writeNoteBridging and
// write/writeNoteMultiSource, everything under search/,
// verify/sourceVerification, everything under multi-agent/, input/prompt, and
// the tool-calling tool schemas together with buildToolList.

const ALL_BOTS: Bot[] = [simpleBot, cheapBot];

export function getEnabledBots(): Bot[] {
  return ALL_BOTS;
}

export function getBotById(id: string): Bot | undefined {
  return ALL_BOTS.find((bot) => bot.id === id);
}

export type { Bot, PipelineResult, PostContent } from "./types";
