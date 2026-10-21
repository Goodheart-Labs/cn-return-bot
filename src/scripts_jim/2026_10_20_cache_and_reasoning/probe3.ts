/**
 * Checks that the cost log of a real research call and of its follow-up now carries the cached tokens.
 *
 *   bun run src/scripts_jim/2026_10_20_cache_and_reasoning/probe3.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_CONFIG, withBotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker, getCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { runStrongSearch } from "../../pipeline/simple-bot/cascadeSearch";
import { LOGS_DIR } from "../2026_09_29_claimchecker_microsite/runStore";

const userMessage: string = JSON.parse(readFileSync(join(LOGS_DIR, "eval-2026-10-20-0348", "ea-earning-to-give.0.json"), "utf8")).logs.note_writer_steps.search.messages["0"].userMessage;
const config = { ...DEFAULT_CONFIG, botId: "simple-bot", commonnotes_pipeline: true, search_cascade: true };

async function main() {
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  await withBotConfig(config, () => withCostTracker(async () => {
    const first = await runStrongSearch(userMessage);
    await runStrongSearch(userMessage, { answer: first.answer ?? "{}", message: "A source checker rejected a note written from your findings. Write revised findings in the same format." });
    console.log(JSON.stringify(getCostTracker().map(({ name, input_tokens, cached_tokens, cache_write_tokens }) => ({ name, input_tokens, cached_tokens, cache_write_tokens }))));
  }));
}

await main();
