/**
 * Search-only smoke test for Mistral models via SearXNG tool-calling loop.
 */

import "dotenv/config";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";

const POST = `Tweet to fact-check:
@someone — "BREAKING: Scientists confirm the Great Wall of China is visible from the Moon with the naked eye."`;

const VARIANTS: Array<{ name: string; search_model: string }> = [
  { name: "mistral-large-3-searxng",    search_model: "mistralai/mistral-large-2512"  },
  { name: "mistral-medium-3.5-searxng", search_model: "mistralai/mistral-medium-3-5"  },
  { name: "mistral-small-4-searxng",    search_model: "mistralai/mistral-small-2603"  },
];

async function main(): Promise<void> {
  for (const v of VARIANTS) {
    const config: BotConfig = {
      ...DEFAULT_CONFIG,
      botId: "simple-bot",
      search_model: v.search_model,
      web_search: "searxng",
    };
    const start = Date.now();
    try {
      const r = await withBotConfig(config, () => dispatchSearch(POST, `smoke.${v.name}`));
      console.log(`✓ ${v.name.padEnd(30)} ${((Date.now() - start)/1000).toFixed(1)}s correctionNeeded=${r.correctionNeeded} cost=$${r.costEntry.cost?.toFixed(4) ?? "?"}`);
      console.log(`  findings preview: ${r.findings.slice(0, 240).replace(/\n/g, " ")}`);
    } catch (err: any) {
      console.log(`✗ ${v.name.padEnd(30)} FAILED: ${(err?.message ?? String(err)).slice(0, 300)}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
