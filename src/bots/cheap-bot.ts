/**
 * cheap-bot
 *
 * The pipeline has five stages. A query writer turns the post into search
 * queries. SearXNG fetches results for those queries. A note writer drafts the
 * note. A note-needed judge decides whether the note is warranted. A source
 * verifier checks the sources the note cites.
 *
 * Most stages run on DeepSeek v4 Flash. The note-needed judge runs on Gemini 3
 * Flash. The models come from the cheap-bot variant of BOT_TEST in
 * src/pipeline/ab-testing/abTestsData.ts.
 *
 * This bot exists so we can hill-climb against
 * datasets/big_eval/splits/val.csv. simple-bot stays untouched and serves
 * production traffic.
 */

import { Bot, PipelineResult, outcomeToResult } from "./types";
import { createBotInput } from "../pipeline/input/createBotInput";
import { runCheapBotPipeline } from "../pipeline/cheap-bot/orchestrator";

export const cheapBot: Bot = {
  id: "cheap-bot",
  name: "Cheap Bot",
  description: "DeepSeek 5-stage: query writer → searXNG → write → note-needed judge → verify",
  async runPipeline(post): Promise<PipelineResult | null> {
    const input = await createBotInput(post, this.id);
    const outcome = await runCheapBotPipeline(post, input);
    return outcomeToResult(post, this.id, outcome);
  },
};
