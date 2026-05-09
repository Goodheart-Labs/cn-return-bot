/**
 * Probe each search-providing model (OpenRouter native + raw provider SDK)
 * to see whether `response_format: { type: "json_object" }` actually forces
 * JSON output, or whether the model emits markdown / preamble despite the flag.
 *
 * The simple-bot search step today passes `response_format: OPENAI_RESPONSE_FORMAT`
 * to OpenRouter, but we still see markdown-fenced and preamble outputs in
 * production. This probe tells us, per provider, which one to trust:
 *
 *   1. Does OpenRouter pass the flag through, or silently drop it?
 *   2. Does the underlying model honor it?
 *   3. If it doesn't, does the provider's own SDK with native JSON-schema mode work?
 *
 * Run from repo root:
 *   bun run src/scripts_jim/2026_05_09_json_parse_failures/02_test_response_format_strictness.ts
 *
 * Output: response_format_results.json with one entry per (model, mode).
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;
const PROBE_PROMPT =
  'Pretend you finished researching a tweet and emit the result as JSON with exactly the fields {"findings": "...", "correction_needed": true|false}. Do not wrap in markdown, do not preamble. Findings: "test".';

const MODELS = [
  "anthropic/claude-sonnet-4.6",
  "google/gemini-3-flash-preview",
  "google/gemini-3-pro-preview",
  "openai/gpt-5",
  "openai/gpt-5-mini",
  "x-ai/grok-4.3",
  "perplexity/sonar-pro",
  "perplexity/sonar-reasoning-pro",
  "deepseek/deepseek-v4-pro",
  "qwen/qwen3-max",
  "moonshotai/kimi-k2.6",
  "z-ai/glm-5",
];

interface Result {
  model: string;
  mode: "openrouter_response_format" | "openrouter_no_format";
  ok: boolean;
  shape: "json" | "markdown_fenced" | "preamble" | "plain_text" | "empty" | "error";
  raw_first_200: string;
  error?: string;
}

function classify(content: string): Result["shape"] {
  const s = content.trim();
  if (!s) return "empty";
  try {
    JSON.parse(s);
    return "json";
  } catch {
    /* fallthrough */
  }
  if (s.startsWith("```") || s.includes("```json")) return "markdown_fenced";
  if (s.startsWith("{") && !s.endsWith("}")) return "preamble"; // mid-truncate
  if (s.includes("{")) return "preamble";
  return "plain_text";
}

async function probe(model: string, withFormat: boolean): Promise<Result> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: PROBE_PROMPT }],
    max_tokens: 200,
  };
  if (withFormat) {
    body.response_format = { type: "json_object" };
  }
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return {
        model,
        mode: withFormat ? "openrouter_response_format" : "openrouter_no_format",
        ok: false,
        shape: "error",
        raw_first_200: "",
        error: `HTTP ${resp.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await resp.json()) as any;
    const content = data?.choices?.[0]?.message?.content ?? "";
    return {
      model,
      mode: withFormat ? "openrouter_response_format" : "openrouter_no_format",
      ok: true,
      shape: classify(content),
      raw_first_200: content.slice(0, 200),
    };
  } catch (err: any) {
    return {
      model,
      mode: withFormat ? "openrouter_response_format" : "openrouter_no_format",
      ok: false,
      shape: "error",
      raw_first_200: "",
      error: err?.message?.slice(0, 200),
    };
  }
}

async function main(): Promise<void> {
  const results: Result[] = [];
  for (const model of MODELS) {
    for (const withFormat of [true, false]) {
      console.log(`probing ${model}  format=${withFormat}`);
      results.push(await probe(model, withFormat));
    }
  }

  const out = join(__dirname, "response_format_results.json");
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${out}\n`);

  // Quick summary table.
  const byModel: Record<string, { with: Result; without: Result }> = {};
  for (const r of results) {
    byModel[r.model] ??= {} as any;
    if (r.mode === "openrouter_response_format") byModel[r.model].with = r;
    else byModel[r.model].without = r;
  }
  console.log(`${"model".padEnd(40)}  with_format        without_format`);
  console.log("-".repeat(85));
  for (const [model, { with: w, without: wo }] of Object.entries(byModel)) {
    console.log(`${model.padEnd(40)}  ${w.shape.padEnd(18)}  ${wo.shape}`);
  }
}

main();
