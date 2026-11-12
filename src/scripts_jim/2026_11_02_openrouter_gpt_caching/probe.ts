/* GOO-688: does prompt caching, flex and OpenAI's web search work for
 * GPT-6.1 Terra through OpenRouter's Responses API? Each probe prints the
 * cache counters OpenRouter reports. The prefix is a ~4K-token slice of the
 * Common Notes examples, starting with a fresh run id so the first request is
 * a cold cache. Costs a few cents.
 *
 * Usage: bun run src/scripts_jim/2026_11_02_openrouter_gpt_caching/probe.ts <probe...>
 * Probes: implicit explicit flex websearch */

import { readFileSync } from "fs";
import * as path from "path";

const URL = "https://openrouter.ai/api/v1/responses";
const MODEL = "openai/gpt-6.1-terra";
const PREFIX_CHARS = 16_000;
const KEY = process.env.OPENROUTER_TESTING_KEY!;
const runId = Math.random().toString(36).slice(2);
const examples = readFileSync(path.resolve(import.meta.dir, "../../../docs/note-examples.md"), "utf8").slice(0, PREFIX_CHARS);
const prefixText = `Run ${runId}.\n\n${examples}`;

type Body = Record<string, unknown>;

async function call(label: string, body: Body): Promise<any> {
  const started = Date.now();
  const response = await fetch(URL, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, ...body }) });
  const json: any = await response.json();
  if (!response.ok || json.error) {
    console.log(`${label}: HTTP ${response.status} ${JSON.stringify(json.error ?? json).slice(0, 600)}`);
    return json;
  }
  const u = json.usage ?? {};
  console.log(
    `${label}: ${Math.round((Date.now() - started) / 1000)}s provider=${json.provider ?? "?"} tier=${json.service_tier} in=${u.input_tokens} cached=${u.input_tokens_details?.cached_tokens} write=${u.input_tokens_details?.cache_write_tokens} writeDetails=${JSON.stringify(u.input_tokens_details?.cache_write_tokens_details)} out=${u.output_tokens} cost=${u.cost} items=${(json.output ?? []).map((i: any) => i.type + (i.action ? `:${i.action.type}` : "")).join(",")}`,
  );
  return json;
}

const developer = (breakpoint: boolean) => ({
  role: "developer",
  content: [{ type: "input_text", text: prefixText, ...(breakpoint ? { prompt_cache_breakpoint: { mode: "explicit", ttl: "12h" } } : {}) }],
});
const user = (text: string) => ({ role: "user", content: text });
const base = { reasoning: { effort: "low" }, store: false, max_output_tokens: 2000 };

/** The same request twice. OpenAI's implicit breakpoint after the user
 *  message should make the second one read everything from the cache. */
async function implicit() {
  const body = { ...base, input: [developer(false), user("Reply with OK.")] };
  await call("implicit 1", body);
  await call("implicit 2 (same)", body);
}

/** Two posts: the same examples, a different task. Only the explicit
 *  breakpoint at the end of the examples lets the second read them. */
async function explicit() {
  await call("explicit 1", { ...base, prompt_cache_key: "cn-notes-probe", input: [developer(true), user("Reply with OK.")] });
  await call("explicit 2 (other task)", { ...base, prompt_cache_key: "cn-notes-probe", input: [developer(true), user("Reply with the word yes.")] });
  await call("no breakpoint (other task)", { ...base, input: [developer(false), user("Reply with the word no.")] });
}

async function flex() {
  await call("flex, explicit (other task)", { ...base, service_tier: "flex", input: [developer(true), user("Reply with the word maybe.")] });
}

const saveQuote = { type: "function", name: "save_quote", description: "Saves a quote", strict: true, parameters: { type: "object", properties: { url: { type: "string" }, quote: { type: "string" } }, required: ["url", "quote"], additionalProperties: false } };
const SEARCH_TASK = "Open https://en.wikipedia.org/wiki/Prompt_engineering, find the sentence that defines prompt engineering, check with find in page that it is there word for word, then call save_quote with it.";
const SEARCH_VARIANTS: Record<string, Body> = {
  "web_search, no include": { tools: [{ type: "web_search" }, saveQuote] },
  "web_search, include sources": { tools: [{ type: "web_search" }, saveQuote], include: ["web_search_call.action.sources"] },
  "web_search, include reasoning": { tools: [{ type: "web_search" }, saveQuote], include: ["reasoning.encrypted_content"] },
  "openrouter native": { tools: [{ type: "openrouter:web_search", parameters: { engine: "native" } }, saveQuote] },
  "openrouter native, include reasoning": { tools: [{ type: "openrouter:web_search", parameters: { engine: "native" } }, saveQuote], include: ["reasoning.encrypted_content"] },
};

/** Turn 1 of each way to ask for web search. Then, for the first way that
 *  answers with a function call, turn 2 sends turn 1 back the way the Agents
 *  SDK does without stored responses. It should be accepted and read turn 1
 *  from the cache. */
async function websearch() {
  const input: any[] = [developer(true), user(SEARCH_TASK)];
  let followUp: { variant: Body; first: any } | null = null;
  for (const [name, variant] of Object.entries(SEARCH_VARIANTS)) {
    const first = await call(`turn 1, ${name}`, { ...base, ...variant, prompt_cache_key: "cn-notes-probe", input });
    for (const item of first.output ?? []) {
      if (item.type === "web_search_call") console.log("   action", JSON.stringify(item.action).slice(0, 160));
      if (item.type === "reasoning") console.log("   reasoning item, encrypted:", Boolean(item.encrypted_content));
      if (item.type === "function_call") console.log("   function_call", item.arguments.slice(0, 160));
    }
    if (first.usage?.server_tool_use_details) console.log("   server tools", JSON.stringify(first.usage.server_tool_use_details));
    if (!followUp && (first.output ?? []).some((i: any) => i.type === "function_call")) followUp = { variant: { ...variant, name }, first };
  }
  if (!followUp) return console.log("No variant reached the function call");
  const { variant, first } = followUp;
  const calls = first.output.filter((i: any) => i.type === "function_call");
  const turn2 = [...input, ...first.output, ...calls.map((c: any) => ({ type: "function_call_output", call_id: c.call_id, output: "Saved." }))];
  const { name, ...rest } = variant as any;
  const second = await call(`turn 2, ${name}`, { ...base, ...rest, prompt_cache_key: "cn-notes-probe", input: turn2 });
  console.log("   turn 1 input tokens:", first.usage?.input_tokens, "turn 2 input:", second.usage?.input_tokens, "turn 2 cached:", second.usage?.input_tokens_details?.cached_tokens);
}

const OUT_DIR = path.join(import.meta.dir, "out");

/** Does the model remember turn 1 in turn 2? Turn 1 researches and saves a
 *  quote. Turn 2 sends turn 1 back with the tool result and asks about a
 *  detail of the page that is not in the quote, without searching again. The
 *  raw answers go to out/ so the items can be read in full. */
async function recall() {
  const { mkdirSync, writeFileSync } = await import("fs");
  mkdirSync(OUT_DIR, { recursive: true });
  const tools = [{ type: "web_search" }, saveQuote];
  const body = { ...base, reasoning: { effort: "medium" }, include: ["reasoning.encrypted_content"], tools, prompt_cache_key: "cn-notes-probe" };
  const input: any[] = [developer(true), user("Open https://en.wikipedia.org/wiki/Prompt_engineering. Call save_quote with the first sentence of its History section. Remember what else the section says.")];
  const first = await call("recall turn 1", { ...body, input });
  writeFileSync(path.join(OUT_DIR, "recall-turn1.json"), JSON.stringify(first, null, 2));
  const calls = (first.output ?? []).filter((i: any) => i.type === "function_call");
  if (!calls.length) return console.log("   no function call in turn 1");
  const turn2 = [
    ...input,
    ...first.output,
    ...calls.map((c: any) => ({ type: "function_call_output", call_id: c.call_id, output: "Saved." })),
    user("Without searching again: which year does the History section name right after the sentence you saved? If you no longer know, say so."),
  ];
  const second = await call("recall turn 2", { ...body, input: turn2 });
  writeFileSync(path.join(OUT_DIR, "recall-turn2.json"), JSON.stringify(second, null, 2));
  console.log("   answer:", second.output_text ?? JSON.stringify(second.output?.at(-1)).slice(0, 400));
  console.log("   turn 1 input:", first.usage?.input_tokens, "turn 2 input:", second.usage?.input_tokens, "turn 2 cached:", second.usage?.input_tokens_details?.cached_tokens);
}

/** Do requests sent at the same moment all read the cache? One request
 *  writes the examples to the cache, then 8 requests with different tasks go
 *  out at once. In a harness run, subagents started in one turn do this. */
async function parallel() {
  const PARALLEL_REQUESTS = 8;
  await call("warm-up", { ...base, prompt_cache_key: "cn-notes-probe", input: [developer(true), user("Reply with OK.")] });
  const answers = await Promise.all(
    Array.from({ length: PARALLEL_REQUESTS }, (_, i) => call(`parallel ${i + 1}`, { ...base, prompt_cache_key: "cn-notes-probe", input: [developer(true), user(`Reply with the number ${i + 1}.`)] })),
  );
  const hits = answers.filter((a) => (a.usage?.input_tokens_details?.cached_tokens ?? 0) > 0).length;
  console.log(`   ${hits} of ${PARALLEL_REQUESTS} parallel requests read the cache`);
}

/** The harness's case: the full examples, written by a request with the main
 *  agent's tools, then read by 4 requests at once with only web search, like
 *  subagents started in one turn. */
async function subagents() {
  const SUBAGENTS = 4;
  const full = { role: "developer", content: [{ type: "input_text", text: `Run ${runId}-full.\n\n${readFileSync(path.resolve(import.meta.dir, "../../../docs/note-examples.md"), "utf8")}`, prompt_cache_breakpoint: { mode: "explicit", ttl: "12h" } }] };
  await call("main", { ...base, prompt_cache_key: "cn-notes-probe", tools: [{ type: "web_search" }, saveQuote], input: [full, user("Reply with OK.")] });
  const answers = await Promise.all(
    Array.from({ length: SUBAGENTS }, (_, i) => call(`subagent ${i + 1}`, { ...base, prompt_cache_key: "cn-notes-probe", tools: [{ type: "web_search" }], input: [full, user(`Reply with the number ${i + 1}.`)] })),
  );
  const hits = answers.filter((a) => (a.usage?.input_tokens_details?.cached_tokens ?? 0) > 0).length;
  console.log(`   ${hits} of ${SUBAGENTS} subagent requests read the cache`);
}

const probes: Record<string, () => Promise<void>> = { implicit, explicit, flex, websearch, recall, parallel, subagents };
for (const name of process.argv.slice(2)) await probes[name]!();
