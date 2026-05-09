/**
 * End-to-end smoke for searchDispatch with web_search="native_grok".
 */

import "dotenv/config";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";

const POST_TEXT = `Tweet to fact-check:
"BREAKING: Tokyo's population just hit 8 million. Massive shrinkage!"`;

async function main(): Promise<void> {
  if (!process.env.XAI_API_KEY) {
    console.error("XAI_API_KEY not set");
    process.exit(1);
  }

  const config: BotConfig = {
    ...DEFAULT_CONFIG,
    botId: "simple-bot",
    search_model: "x-ai/grok-4-fast", // cheaper, same code path as grok-4.3
    web_search: "native_grok",
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
