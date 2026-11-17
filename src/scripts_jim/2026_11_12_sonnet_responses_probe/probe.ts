/**
 * Does Sonnet 5.5 work through OpenRouter's Responses API the way the GPT
 * harness uses it: function tools, medium reasoning, stateless requests, and a
 * cache breakpoint at the end of a long system prompt? Two requests with the
 * same prefix show whether the second one reads it from the cache.
 *
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_11_12_sonnet_responses_probe/probe.ts [cache_control|none]
 */
import "dotenv/config";
import { readFileSync } from "fs";

const MODEL = "anthropic/claude-sonnet-5.5";
const examples = readFileSync("docs/x-note-examples.md", "utf8");
const mode = process.argv[2] ?? "cache_control";

const examplesPart = mode === "cache_control"
  ? { type: "input_text", text: examples, cache_control: { type: "ephemeral", ttl: "1h" } }
  : { type: "input_text", text: examples };

async function call(question: string) {
  const response = await fetch("https://openrouter.ai/api/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_TESTING_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: "developer", content: [examplesPart] }, { role: "user", content: [{ type: "input_text", text: question }] }],
      tools: [{ type: "function", name: "search", description: "Searches Google.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }, strict: true }],
      reasoning: { effort: "medium", summary: "auto" },
      store: false,
      include: ["reasoning.encrypted_content"],
      provider: { only: ["anthropic"] },
    }),
  });
  const body: any = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body).slice(0, 800)}`);
  return body;
}

for (const question of ["Is it true that Kevin Hart cried about Dwayne Johnson's health in November 2026? Search first.", "Did the Eiffel Tower close in November 2026? Search first."]) {
  const body = await call(question);
  console.log(JSON.stringify({ usage: body.usage, output: body.output.map((item: any) => ({ type: item.type, name: item.name, arguments: item.arguments, summary: item.summary, hasEncrypted: !!item.encrypted_content })) }, null, 1));
}
