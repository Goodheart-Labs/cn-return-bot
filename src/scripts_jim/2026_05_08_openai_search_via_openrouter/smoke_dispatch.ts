/**
 * End-to-end smoke for searchDispatch with web_search="native_openai".
 */

import "dotenv/config";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";

const POST_TEXT = `Tweet to fact-check:
"BREAKING: Tokyo's population just hit 8 million. Massive shrinkage!"`;

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not set");
    process.exit(1);
  }

  const config: BotConfig = {
    ...DEFAULT_CONFIG,
    botId: "simple-bot",
    search_model: "openai/gpt-5.4-mini",
    web_search: "native_openai",
  };

  const start = Date.now();
  const result = await withBotConfig(config, () => dispatchSearch(POST_TEXT, "test.search"));
  const ms = Date.now() - start;

  console.log("\n=== Result ===");
  console.log("correctionNeeded:", result.correctionNeeded);
  console.log("findings (first 800):", result.findings.slice(0, 800));
  console.log("\n=== Cost ===");
  console.log(JSON.stringify(result.costEntry, null, 2));
  console.log(`\nElapsed: ${ms}ms`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
