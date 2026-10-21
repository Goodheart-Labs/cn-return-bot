/**
 * Two questions about the stronger research call (Sonnet 5.5 through OpenRouter, with the web search tool):
 * 1. Does `reasoning_effort` reach the model? It prints the reasoning tokens for four settings.
 * 2. Does the second round's follow-up read the first call from Anthropic's prompt cache? It prints the cached
 *    tokens of a first call, of a follow-up that continues it, and of the first call again.
 *
 *   bun run src/scripts_jim/2026_10_20_cache_and_reasoning/probe.ts
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
const cached = (text: string) => [{ type: "text", text, cache_control: { type: "ephemeral" } }];

async function call(label: string, extra: Record<string, unknown>, messages: any[]) {
  const response: any = await llm.create({ model: CASCADE_COMMONNOTES_STRONG_MODEL, tools: [WEB_SEARCH_TOOL], ...extra, messages } as any);
  const usage = response.usage ?? {};
  const message = response.choices?.[0]?.message ?? {};
  console.log(label, JSON.stringify({ prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, completion_details: usage.completion_tokens_details, prompt_details: usage.prompt_tokens_details, cost: usage.cost, reasoning_field: message.reasoning ? `${String(message.reasoning).length} chars` : null, reasoning_details: Array.isArray(message.reasoning_details) ? message.reasoning_details.length : null }));
  return message.content as string;
}

async function main() {
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  const plain = [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }];
  console.log("REASONING");
  await Promise.all([
    call("no setting     ", {}, plain),
    call("effort low     ", { reasoning_effort: "low" }, plain),
    call("effort medium  ", { reasoning_effort: "medium" }, plain),
    call("effort high    ", { reasoning_effort: "high" }, plain),
    call("reasoning.medium", { reasoning: { effort: "medium" } }, plain),
  ]);
  console.log("CACHE");
  const first = [{ role: "system", content: cached(systemPrompt) }, { role: "user", content: cached(userMessage) }];
  const answer = await call("first call            ", { reasoning_effort: "medium" }, first);
  await call("follow-up (same prefix)", { reasoning_effort: "medium" }, [...first, { role: "assistant", content: answer }, { role: "user", content: "A source checker rejected a note written from your findings. Write revised findings in the same format." }]);
  await call("first call again      ", { reasoning_effort: "medium" }, first);
}

await main();
