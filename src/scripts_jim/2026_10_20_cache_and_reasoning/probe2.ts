/**
 * Follow-up to probe.ts. 1. A question that needs thinking, without tools, at four reasoning settings: do the reasoning
 * tokens grow with the setting? 2. The same research call 8 times with the web search tool: in how many does a search
 * run? A call that searched has about 10,000 more prompt tokens than the 3,500 it was sent, because the pages are added.
 *
 *   bun run src/scripts_jim/2026_10_20_cache_and_reasoning/probe2.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { llm } from "../../pipeline/llm/llm";
import { WEB_SEARCH_TOOL } from "../../pipeline/tool-calling/tools";
import { SEARCH_SYSTEM_PROMPT_CLAIM_MISLEADING, withSourceUrlInstruction } from "../../pipeline/prompts/simple-bot/searchAgent";
import { CASCADE_COMMONNOTES_STRONG_MODEL } from "../../pipeline/simple-bot/cascadeSearch";
import { LOGS_DIR } from "../2026_09_29_claimchecker_microsite/runStore";

const SOURCE_LOG = join(LOGS_DIR, "eval-2026-10-20-0348", "ea-earning-to-give.0.json");
const userMessage: string = JSON.parse(readFileSync(SOURCE_LOG, "utf8")).logs.note_writer_steps.search.messages["0"].userMessage;
const systemPrompt = withSourceUrlInstruction(SEARCH_SYSTEM_PROMPT_CLAIM_MISLEADING);
const RIDDLE = "Three boxes are labelled Apples, Oranges and Mixed, and every label is wrong. You may take one fruit out of one box. Which box do you open, and how do you then relabel all three? Explain step by step, then check your answer against every possible content arrangement.";

async function main() {
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  console.log("REASONING, no tools");
  await Promise.all([undefined, "low", "medium", "high"].map(async (effort) => {
    const r: any = await llm.create({ model: CASCADE_COMMONNOTES_STRONG_MODEL, ...(effort ? { reasoning_effort: effort } : {}), messages: [{ role: "user", content: RIDDLE }] } as any);
    console.log(String(effort).padEnd(10), "completion", r.usage?.completion_tokens, "reasoning", r.usage?.completion_tokens_details?.reasoning_tokens);
  }));
  console.log("SEARCH RATE, medium effort, 8 calls");
  const sizes = await Promise.all(Array.from({ length: 8 }, async () => {
    const r: any = await llm.create({ model: CASCADE_COMMONNOTES_STRONG_MODEL, tools: [WEB_SEARCH_TOOL], reasoning_effort: "medium", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }] } as any);
    const content: string = r.choices?.[0]?.message?.content ?? "";
    return { prompt: r.usage?.prompt_tokens, annotations: (r.choices?.[0]?.message?.annotations ?? []).length, saysNoSearch: /did not run|not run a search|No search was run/i.test(content) };
  }));
  sizes.forEach((s) => console.log(JSON.stringify(s)));
  console.log("searched:", sizes.filter((s) => s.prompt > 6000).length, "of", sizes.length);
}

await main();
