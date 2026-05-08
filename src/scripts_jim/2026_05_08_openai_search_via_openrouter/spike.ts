/**
 * Phase 0 spike: does OpenRouter pass through OpenAI's web_search_preview tool?
 *
 * If yes, simple-bot's `searchWithOpenaiNative` helper can be a thin
 * `llm.create` wrapper. If no, we'll need a native OpenAI SDK client in
 * src/pipeline/llm/openai.ts that calls the Responses API directly.
 *
 * Run: bun run src/scripts_jim/2026_05_08_openai_search_via_openrouter/spike.ts
 */

import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL = "openai/gpt-5.4-mini";
const QUERY = "What major news happened on May 7 2026? Cite at least one URL.";

function printResult(label: string, result: any): void {
  console.log(`\n${"=".repeat(60)}\n${label}\n${"=".repeat(60)}`);
  const msg = result.choices?.[0]?.message;
  console.log("Content:", msg?.content?.slice(0, 800));
  console.log("Annotations (first 3):", JSON.stringify(msg?.annotations?.slice(0, 3), null, 2));
  console.log("Tool calls:", JSON.stringify(msg?.tool_calls?.map((tc: any) => ({
    name: tc.function?.name ?? tc.type,
    args: tc.function?.arguments?.slice(0, 200),
  })), null, 2));
  console.log("Usage:", JSON.stringify(result.usage));
}

// 1. No tools — sanity that the model is reachable.
async function testBasic(): Promise<void> {
  const result = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: "What is 2+2? One word." }],
    max_tokens: 1000,
  });
  printResult("Basic completion", result);
}

// 2. Pass OpenAI's Responses-API web_search_preview tool spec via OpenRouter.
async function testWebSearchPreview(): Promise<void> {
  const result = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: QUERY }],
    max_tokens: 1500,
    tools: [{ type: "web_search_preview" as any } as any],
  } as any);
  printResult("web_search_preview tool", result);
}

// 3. Try the bare "web_search" type name (some providers normalize).
async function testWebSearchBare(): Promise<void> {
  const result = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: QUERY }],
    max_tokens: 1500,
    tools: [{ type: "web_search" as any, name: "web_search" } as any],
  } as any);
  printResult("bare web_search tool", result);
}

// 4. Try Anthropic-style web_search_20260209 (since OpenRouter passes that for Claude).
async function testWebSearchClaudeStyle(): Promise<void> {
  const result = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: QUERY }],
    max_tokens: 1500,
    tools: [{ type: "web_search_20260209" as any, name: "web_search" } as any],
  } as any);
  printResult("Claude-style web_search_20260209 tool", result);
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not set");
    process.exit(1);
  }
  for (const fn of [testBasic, testWebSearchPreview, testWebSearchBare, testWebSearchClaudeStyle]) {
    try {
      await fn();
    } catch (err: any) {
      console.log(`\n${"=".repeat(60)}\n${fn.name} FAILED\n${"=".repeat(60)}`);
      console.log("Error:", err?.status, err?.message?.slice(0, 500));
      console.log("Body:", JSON.stringify(err?.error)?.slice(0, 500));
    }
  }
}

main();
