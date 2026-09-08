/**
 * End-to-end check of the Serper search loop on Muse.
 *
 * Muse rejects the forced tool call the loop sends on turn 1, so the loop now
 * falls back to an unforced turn. This runs the real dispatchSearch against the
 * real Serper backend to confirm the whole loop completes, rather than just
 * that the fallback compiles.
 *
 * Run: bun run src/scripts_jim/2026_09_07_muse_openrouter_probe/verifySearchLoop.ts
 */

import "dotenv/config";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";
import { withBotConfig, DEFAULT_CONFIG } from "../../pipeline/ab-testing/botConfig";

if (process.env.OPENROUTER_TESTING_KEY) {
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  console.log("Using OPENROUTER_TESTING_KEY for OpenRouter calls.\n");
}

const CLAIM =
  "Check this claim from a tweet: \"The Eiffel Tower was moved to Berlin in 2019.\"";

async function run(model: string) {
  const config = { ...DEFAULT_CONFIG, search_model: model, web_search: "serper" as const };
  const started = Date.now();
  const result = await withBotConfig(config, () => dispatchSearch(CLAIM, "search"));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${model}`);
  console.log(`  completed in ${seconds}s, cost $${result.costEntry.cost ?? 0}`);
  console.log(`  correctionNeeded: ${result.correctionNeeded}`);
  console.log(`  findings: ${String(result.findings).slice(0, 300)}`);
}

async function main() {
  // Muse is the model the fallback exists for.
  await run("meta/muse-spark-1.3-contributor");
  console.log();
  // A model that accepts the forced call, to confirm nothing else changed.
  await run("z-ai/glm-5.3-flash");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
