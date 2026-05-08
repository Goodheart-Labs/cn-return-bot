/**
 * Smoke-test simple-bot's searchDispatch with web_search="native_gemini".
 * Calls dispatchSearch directly with a fake config in ALS.
 */

import "dotenv/config";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/utils/botConfig";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";

const POST_TEXT = `Tweet to fact-check:
"BREAKING: Tokyo's population just hit 8 million. The city is shrinking fast!"`;

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set");
    process.exit(1);
  }

  const config: BotConfig = {
    ...DEFAULT_CONFIG,
    botId: "simple-bot",
    search_model: "google/gemini-3-flash-preview",
    web_search: "native_gemini",
  };

  const start = Date.now();
  const result = await withBotConfig(config, () =>
    dispatchSearch(POST_TEXT, "test.search"),
  );
  const ms = Date.now() - start;

  console.log("\n=== Result ===");
  console.log("correctionNeeded:", result.correctionNeeded);
  console.log("findings (first 800 chars):");
  console.log(result.findings.slice(0, 800));
  console.log("\n=== Cost ===");
  console.log(JSON.stringify(result.costEntry, null, 2));
  console.log(`\nElapsed: ${ms}ms`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
