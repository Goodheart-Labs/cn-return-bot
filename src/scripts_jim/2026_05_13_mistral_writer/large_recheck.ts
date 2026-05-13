/**
 * Re-run mistral-large-3 through the searxng loop on a different prompt to
 * confirm it's not just a one-off success.
 */

import "dotenv/config";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";

const POST = `Tweet to fact-check:
@energyhq — "FACT: Wind turbines kill more birds than all other human causes combined. We must stop building them immediately."`;

async function main(): Promise<void> {
  const config: BotConfig = {
    ...DEFAULT_CONFIG,
    botId: "simple-bot",
    search_model: "mistralai/mistral-large-2512",
    web_search: "searxng",
  };
  const start = Date.now();
  try {
    const r = await withBotConfig(config, () =>
      withCostTracker(() => dispatchSearch(POST, "recheck")),
    );
    console.log(`✓ ${((Date.now() - start) / 1000).toFixed(1)}s correctionNeeded=${r.correctionNeeded} cost=$${r.costEntry.cost?.toFixed(4) ?? "?"}`);
    console.log(`findings:\n${r.findings}`);
  } catch (err: any) {
    console.log(`✗ FAILED: ${(err?.message ?? String(err)).slice(0, 400)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
