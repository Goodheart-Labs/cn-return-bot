/* GOO-688: the same memory test as `probe.ts recall`, against OpenAI
 * directly. Turn 1 reads a page with web search and saves a quote. Turn 2 asks
 * about a detail of the page next to the quote, without searching. It is
 * asked twice:
 *   - replayed: turn 1 sent back as items, the way the harness does now;
 *   - chained: continued with previous_response_id, so OpenAI keeps the
 *     conversation itself.
 * Also prints the web search actions, which OpenRouter hides.
 *
 * Usage: bun run src/scripts_jim/2026_11_02_openrouter_gpt_caching/direct.ts */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";

const URL = "https://api.openai.com/v1/responses";
const OUT_DIR = path.join(import.meta.dir, "out");
const examples = readFileSync(path.resolve(import.meta.dir, "../../../docs/note-examples.md"), "utf8").slice(0, 2_000);
const developer = { role: "developer", content: [{ type: "input_text", text: `Run ${Math.random().toString(36).slice(2)}.\n\n${examples}` }] };
const saveQuote = { type: "function", name: "save_quote", description: "Saves a quote", strict: true, parameters: { type: "object", properties: { url: { type: "string" }, quote: { type: "string" } }, required: ["url", "quote"], additionalProperties: false } };
const base = { model: "gpt-6.1-terra", reasoning: { effort: "medium" }, tools: [{ type: "web_search" }, saveQuote], include: ["web_search_call.action.sources"], max_output_tokens: 1500 };
const QUESTION = "Without searching again: which year does the History section name right after the sentence you saved? If you no longer know, say so.";

/** The key's organisation may use only 10,000 tokens per minute, so each
 *  request waits for the minute to pass. */
const RATE_LIMIT_WAIT_MS = 65_000;

async function call(label: string, body: Record<string, unknown>): Promise<any> {
  await Bun.sleep(RATE_LIMIT_WAIT_MS);
  const response = await fetch(URL, { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...base, ...body }) });
  const json: any = await response.json();
  if (json.error) throw new Error(`${label}: ${JSON.stringify(json.error)}`);
  const u = json.usage;
  console.log(`${label}: tier=${json.service_tier} in=${u.input_tokens} cached=${u.input_tokens_details?.cached_tokens} write=${u.input_tokens_details?.cache_write_tokens} out=${u.output_tokens}`);
  for (const item of json.output) {
    if (item.type === "web_search_call") console.log(`   web_search_call ${JSON.stringify(item.action).slice(0, 200)}`);
    if (item.type === "function_call") console.log(`   function_call ${item.arguments.slice(0, 200)}`);
    if (item.type === "message") console.log(`   answer: ${item.content.map((c: any) => c.text).join(" ")}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, `direct-${label.replace(/\W+/g, "-")}.json`), JSON.stringify(json, null, 2));
  return json;
}

const input: any[] = [developer, { role: "user", content: "Open https://en.wikipedia.org/wiki/Prompt_engineering. Call save_quote with the first sentence of its History section. Remember what else the section says." }];
const first = await call("turn 1", { input });
const calls = first.output.filter((i: any) => i.type === "function_call");
const results = calls.map((c: any) => ({ type: "function_call_output", call_id: c.call_id, output: "Saved." }));
await call("turn 2 replayed", { input: [...input, ...first.output, ...results, { role: "user", content: QUESTION }] });
await call("turn 2 chained", { previous_response_id: first.id, input: [...results, { role: "user", content: QUESTION }] });
