/**
 * Tests two claims about why Sonnet research answers fail, straight against
 * Anthropic's Messages API and not through OpenRouter.
 *
 * Claim 1: structured outputs (output_config.format) cannot be combined with the
 * citations that web search and web fetch produce, and the API answers 400.
 * Claim 2 (ours): an empty answer with the finish reason "tool_calls" is a turn
 * that stopped with stop_reason "pause_turn", because the server-side tool loop
 * hit its iteration limit. The client is then expected to send the reply back to
 * continue it, which OpenRouter's chat completions endpoint cannot do for us.
 *
 * Variants, each on two real inputs:
 *   once        web search and fetch tools, JSON asked for in the prompt, one request
 *   continued   the same, but a pause_turn reply is sent back until the turn ends
 *   schema      the same tools with output_config.format (json_schema), one request
 *
 *   bun run src/scripts_jim/2026_10_19_sonnet_json_failures/direct.ts [samples]
 */
import "dotenv/config";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { SEARCH_PROMPTED_JSON_INSTRUCTION, SEARCH_SYSTEM_PROMPT, SEARCH_SYSTEM_PROMPT_CLAIM } from "../../pipeline/prompts/simple-bot/searchAgent";
import { extractJsonObject } from "../../pipeline/utils/jsonOutput";

const DIR = new URL(".", import.meta.url).pathname;
const MODELS = (process.env.MODELS ?? "claude-sonnet-5,claude-sonnet-5-5").split(",");
const ALL_VARIANTS = ["once", "continued", "schema"] as const;
const VARIANTS = (process.env.VARIANTS ?? "once,continued,schema").split(",") as unknown as typeof ALL_VARIANTS;
const MAX_CONTINUATIONS = 6;
const MAX_TOKENS = 8000;
const CONCURRENCY = 4;
const TOOLS = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20250910", name: "web_fetch", max_uses: 3, max_content_tokens: 20000 },
];
const SCHEMA = { type: "object", properties: { findings: { type: "string" }, correction_needed: { type: "boolean" } }, required: ["findings", "correction_needed"], additionalProperties: false };
const inputs = JSON.parse(readFileSync(join(DIR, "inputs.json"), "utf8"));
const INPUTS: Record<string, { system: string; user: string }> = {
  "x-steam": { system: SEARCH_SYSTEM_PROMPT, user: inputs["x-steam"] },
  "cn-berkeley": { system: SEARCH_SYSTEM_PROMPT_CLAIM, user: inputs["cn-berkeley"] },
};

async function post(body: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

function classify(text: string): string {
  if (!text.trim()) return "empty";
  try {
    const parsed = JSON.parse(extractJsonObject(text));
    return typeof parsed.findings === "string" && typeof parsed.correction_needed === "boolean" ? "valid" : "wrong_shape";
  } catch {
    return "invalid_json";
  }
}

async function one(model: string, input: string, variant: (typeof VARIANTS)[number], sample: number) {
  const { system, user } = INPUTS[input]!;
  const prompted = variant !== "schema";
  const base = {
    model,
    max_tokens: MAX_TOKENS,
    system: prompted ? `${system}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}` : system,
    tools: TOOLS,
    ...(prompted ? {} : { output_config: { format: { type: "json_schema", schema: SCHEMA } } }),
  };
  const messages: any[] = [{ role: "user", content: user }];
  const stopReasons: string[] = [];
  const toolUses: Record<string, number> = {};
  let finalText = "";
  let httpError: string | null = null;
  for (let turn = 0; turn <= (variant === "continued" ? MAX_CONTINUATIONS : 0); turn++) {
    const { status, json } = await post({ ...base, messages });
    if (status !== 200) {
      httpError = `HTTP ${status}: ${JSON.stringify(json?.error ?? json).slice(0, 200)}`;
      break;
    }
    appendFileSync(join(DIR, "direct-full.jsonl"), JSON.stringify({ model, input, variant, sample, turn, response: json }) + "\n");
    stopReasons.push(json.stop_reason);
    for (const block of json.content ?? []) if (block.type === "server_tool_use") toolUses[block.name] = (toolUses[block.name] ?? 0) + 1;
    finalText = (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    if (json.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: json.content });
  }
  const row = { model, input, variant, sample, verdict: httpError ? "http_error" : classify(finalText), stopReasons: stopReasons.join(">"), toolUses: JSON.stringify(toolUses), detail: httpError ?? "", tail: finalText.slice(-120) };
  appendFileSync(join(DIR, "direct.jsonl"), JSON.stringify(row) + "\n");
  return row;
}

async function main() {
  const samples = Number(process.argv[2] ?? 6);
  writeFileSync(join(DIR, "direct.jsonl"), "");
  writeFileSync(join(DIR, "direct-full.jsonl"), "");
  const queue = new PQueue({ concurrency: CONCURRENCY });
  const jobs = MODELS.flatMap((m) => Object.keys(INPUTS).flatMap((i) => VARIANTS.flatMap((v) => Array.from({ length: v === "schema" ? Math.min(samples, 3) : samples }, (_, s) => () => one(m, i, v, s)))));
  const rows = await Promise.all(jobs.map((job) => queue.add(job) as Promise<Awaited<ReturnType<typeof one>>>));
  console.log("model | input | variant | valid / total | stop reasons and failures");
  for (const m of MODELS) for (const i of Object.keys(INPUTS)) for (const v of VARIANTS) {
    const cell = rows.filter((r) => r.model === m && r.input === i && r.variant === v);
    const notes = cell.map((r) => `${r.verdict === "valid" ? "ok" : r.verdict}[${r.stopReasons || r.detail.slice(0, 60)}]`).join(" ");
    console.log(`${m} | ${i} | ${v} | ${cell.filter((r) => r.verdict === "valid").length}/${cell.length} | ${notes}`);
  }
}

await main();
