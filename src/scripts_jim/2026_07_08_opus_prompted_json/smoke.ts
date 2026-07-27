/**
 * Empirical test for the Opus native-search prompted-JSON fix.
 *
 * Replicates the exact request searchWithAnthropicNative now makes (Opus 4.8 +
 * web_search tool + prompted JSON, NO response_format) and, for each post,
 * reports on the RAW model output:
 *   - salad?     token-salad / garble heuristic (the old response_format bug)
 *   - naiveOk?   does plain stripJsonFences + JSON.parse succeed? (minimal fix)
 *   - extractOk? does extractJsonObject + JSON.parse succeed?     (preamble-aware)
 *
 * This tells us whether the minimal approach suffices or whether we need the
 * preamble-aware extractor.
 */

import "dotenv/config";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { llm } from "../../pipeline/llm/llm";
import { WEB_SEARCH_TOOL } from "../../pipeline/tool-calling/tools";
import { getSearchSystemPrompt } from "../../pipeline/simple-bot/searchDispatch";
import { SEARCH_PROMPTED_JSON_INSTRUCTION } from "../../pipeline/prompts/simple-bot/searchAgent";
import { stripJsonFences, extractJsonObject } from "../../pipeline/utils/jsonOutput";

const OPUS = "anthropic/claude-opus-4.8";

const POSTS: string[] = [
  `Tweet to fact-check:\n"At 96, Clint Eastwood gave a speech last week saying he's lonely and abandoned by his family and that fame is worthless."`,
  `Tweet to fact-check:\n"BREAKING: The Eiffel Tower was sold for scrap metal twice by con man Victor Lustig in the 1920s."`,
  `Tweet to fact-check:\n"Drinking celery juice every morning cures type 2 diabetes within 30 days — doctors won't tell you this."`,
  `Tweet to fact-check:\n"The Great Wall of China is the only man-made structure visible from space with the naked eye."`,
  `Tweet to fact-check:\n"NASA confirmed that on July 4th the Earth will experience 15 minutes of total darkness due to a rare planetary alignment."`,
];

function looksLikeSalad(text: string): boolean {
  // Heuristics from the ablation: leaked tool-call XML, or long runs of repeated
  // short tokens ("Cl Cl Cl", "list list list").
  if (/<\/?(invoke|parameter|antml)/i.test(text)) return true;
  const repeatedToken = /\b(\w{1,6})\b(?:\s+\1\b){3,}/i.test(text);
  return repeatedToken;
}

function tryParse(fn: (s: string) => string, raw: string): { ok: boolean; value?: unknown } {
  try {
    return { ok: true, value: JSON.parse(fn(raw)) };
  } catch {
    return { ok: false };
  }
}

async function rawOpusSearch(userMessage: string): Promise<string> {
  const systemPrompt = `${getSearchSystemPrompt()}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}`;
  const response = await llm.create({
    model: OPUS,
    messages: [
      { role: "system" as const, content: [{ type: "text", text: systemPrompt }] },
      { role: "user" as const, content: userMessage },
    ],
    tools: [WEB_SEARCH_TOOL],
  } as any);
  return response.choices?.[0]?.message?.content ?? "";
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not set");
    process.exit(1);
  }

  const config: BotConfig = {
    ...DEFAULT_CONFIG,
    botId: "simple-bot",
    search_model: OPUS,
    web_search: "native",
  };

  let saladCount = 0;
  let naiveOkCount = 0;
  let extractOkCount = 0;

  for (const [i, post] of POSTS.entries()) {
    const raw = await withBotConfig(config, () => rawOpusSearch(post));
    const salad = looksLikeSalad(raw);
    const naive = tryParse(stripJsonFences, raw);
    const extract = tryParse(extractJsonObject, raw);

    if (salad) saladCount++;
    if (naive.ok) naiveOkCount++;
    if (extract.ok) extractOkCount++;

    console.log(`\n===== POST ${i + 1} (len=${raw.length}) =====`);
    console.log(`salad=${salad}  naiveOk=${naive.ok}  extractOk=${extract.ok}`);
    console.log(`HEAD: ${JSON.stringify(raw.slice(0, 120))}`);
    console.log(`TAIL: ${JSON.stringify(raw.slice(-120))}`);
    const parsed = (extract.value ?? naive.value) as { findings?: string; correction_needed?: boolean } | undefined;
    if (parsed) {
      console.log(`correction_needed=${parsed.correction_needed}  findings[0..100]=${JSON.stringify((parsed.findings ?? "").slice(0, 100))}`);
    }
  }

  const n = POSTS.length;
  console.log(`\n\n========== SUMMARY (n=${n}) ==========`);
  console.log(`salad (garbled):      ${saladCount}/${n}`);
  console.log(`naive parse ok:       ${naiveOkCount}/${n}   (minimal: stripJsonFences only)`);
  console.log(`extractJsonObject ok: ${extractOkCount}/${n}   (preamble-aware)`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
