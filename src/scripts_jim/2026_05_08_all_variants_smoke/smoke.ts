/**
 * Run dispatchSearch for every simple-bot variant against a single test prompt.
 * Confirms each model slug + API endpoint actually responds with grounded JSON.
 */

import "dotenv/config";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";

const POST = `Tweet to fact-check:
"BREAKING: Tokyo's population just hit 8 million. Massive shrinkage!"`;

const VARIANTS: Array<{ name: string; search_model: string; web_search: BotConfig["web_search"] }> = [
  // already verified earlier — included for regression
  { name: "sonnet46-native",         search_model: "anthropic/claude-sonnet-4.6",       web_search: "native" },
  { name: "haiku45-native",          search_model: "anthropic/claude-haiku-4.5",        web_search: "native" },
  { name: "grok43-native",           search_model: "x-ai/grok-4.3",                     web_search: "native_grok" },
  { name: "gemini3flash-native",     search_model: "google/gemini-3-flash-preview",     web_search: "native_gemini" },
  // new / fixed slugs
  { name: "gemini3pro-native",       search_model: "google/gemini-3-pro-preview",       web_search: "native_gemini" },
  { name: "sonar-reasoning-pro",     search_model: "perplexity/sonar-reasoning-pro",    web_search: "bundled" },
  { name: "sonar-pro",               search_model: "perplexity/sonar-pro",              web_search: "bundled" },
  { name: "kimi-k26-searxng",        search_model: "moonshotai/kimi-k2.6",              web_search: "searxng" },
  { name: "deepseek-v4pro-searxng",  search_model: "deepseek/deepseek-v4-pro",          web_search: "searxng" },
  { name: "deepseek-v32exp-searxng", search_model: "deepseek/deepseek-v3.2-exp",        web_search: "searxng" },
  { name: "glm5-searxng",            search_model: "z-ai/glm-5",                        web_search: "searxng" },
  { name: "qwen3max-searxng",        search_model: "qwen/qwen3-max",                    web_search: "searxng" },
];

async function main(): Promise<void> {
  const results: { name: string; ok: boolean; ms: number; cost?: number; correctionNeeded?: boolean; err?: string }[] = [];

  for (const v of VARIANTS) {
    const config: BotConfig = {
      ...DEFAULT_CONFIG,
      botId: "simple-bot",
      search_model: v.search_model,
      web_search: v.web_search,
    };
    const start = Date.now();
    try {
      const r = await withBotConfig(config, () => dispatchSearch(POST, `smoke.${v.name}`));
      results.push({
        name: v.name,
        ok: true,
        ms: Date.now() - start,
        cost: r.costEntry.cost,
        correctionNeeded: r.correctionNeeded,
      });
      console.log(`✓ ${v.name.padEnd(26)} ${(Date.now() - start)/1000}s correctionNeeded=${r.correctionNeeded} cost=$${r.costEntry.cost?.toFixed(4) ?? "?"}`);
    } catch (err: any) {
      const msg = (err?.message ?? String(err)).slice(0, 200);
      results.push({ name: v.name, ok: false, ms: Date.now() - start, err: msg });
      console.log(`✗ ${v.name.padEnd(26)} ${(Date.now() - start)/1000}s FAILED: ${msg}`);
    }
  }

  const ok = results.filter(r => r.ok).length;
  const fail = results.length - ok;
  console.log(`\n=== ${ok}/${results.length} passed (${fail} failed) ===`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
