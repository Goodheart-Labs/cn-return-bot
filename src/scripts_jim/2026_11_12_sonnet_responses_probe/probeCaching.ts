/**
 * The Responses API ignored cache_control on a content part for Sonnet 5.5.
 * This tries the two other ways OpenRouter documents for Anthropic: a
 * top-level cache_control on a Responses request, and cache_control on the
 * system message's content part in a Chat Completions request. Each variant
 * sends the same prefix twice, so the second request shows a cache read.
 *
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_11_12_sonnet_responses_probe/probeCaching.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";

const MODEL = "anthropic/claude-sonnet-5.5";
const examples = readFileSync("docs/x-note-examples.md", "utf8");
const headers = { Authorization: `Bearer ${process.env.OPENROUTER_TESTING_KEY}`, "Content-Type": "application/json" };
const searchTool = { name: "search", description: "Searches Google.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } };
const QUESTIONS = ["Did the Eiffel Tower close in November 2026? Search first.", "Did the Louvre close in November 2026? Search first."];

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const json: any = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(json).slice(0, 600)}`);
  return json;
}

const responsesTopLevel = (question: string) => post("https://openrouter.ai/api/v1/responses", {
  model: MODEL,
  cache_control: { type: "ephemeral", ttl: "1h" },
  input: [{ role: "developer", content: [{ type: "input_text", text: examples }] }, { role: "user", content: [{ type: "input_text", text: question }] }],
  tools: [{ type: "function", ...searchTool, strict: true }],
  reasoning: { effort: "medium" },
  store: false,
  provider: { only: ["anthropic"] },
});

const chatContentPart = (question: string) => post("https://openrouter.ai/api/v1/chat/completions", {
  model: MODEL,
  messages: [
    { role: "system", content: [{ type: "text", text: examples, cache_control: { type: "ephemeral", ttl: "1h" } }] },
    { role: "user", content: question },
  ],
  tools: [{ type: "function", function: searchTool }],
  reasoning: { effort: "medium" },
  usage: { include: true },
  provider: { only: ["anthropic"] },
});

for (const [name, call] of [["responses, top-level cache_control", responsesTopLevel], ["chat completions, cache_control on the system part", chatContentPart]] as const) {
  for (const question of QUESTIONS) {
    try {
      const body = await call(question);
      console.log(name, JSON.stringify(body.usage));
    } catch (err) {
      console.log(name, "FAILED", (err as Error).message);
    }
  }
}
