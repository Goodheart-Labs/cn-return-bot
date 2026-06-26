/**
 * Reproduce + verify the fix for opus-4.8 native-search failures.
 *
 * Diagnosis (via raw OpenRouter response): the "empty content" failures are
 * Anthropic OVERLOADS surfaced as a 200 with finish_reason "error" /
 * native_finish_reason "overloaded_error" and ~empty content — not an exception.
 *
 * This now calls the (fixed) llm.create wrapper, which detects that case and
 * retries with backoff, then either returns valid content or throws a clear
 * "upstream returned ... after N attempts" error (instead of a silent empty that
 * downstream mislabels model_output_invalid). Pass --raw to dump the raw response.
 *
 *   bun run src/scripts_jim/2026_06_26_opus_search_repro/repro.ts
 *   bun run src/scripts_jim/2026_06_26_opus_search_repro/repro.ts --raw
 */

import "dotenv/config";
import * as fs from "fs";
import OpenAI from "openai";
import { llm } from "../../pipeline/llm/llm";
import { WEB_SEARCH_TOOL } from "../../pipeline/tool-calling/tools";
import { SEARCH_RESPONSE_FORMAT } from "../../pipeline/prompts/simple-bot/searchAgent";

const MODEL = "anthropic/claude-opus-4.8";
const RAW = process.argv.includes("--raw");

const systemPrompt = fs.readFileSync("/tmp/failed_system_prompt.txt", "utf8");
const userMessage = fs.readFileSync("/tmp/failed_user_message.txt", "utf8");

const messages = [
  { role: "system" as const, content: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] as any },
  { role: "user" as const, content: userMessage },
];

async function rawDump() {
  const client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY });
  const resp: any = await client.chat.completions.create({
    model: MODEL, messages, tools: [WEB_SEARCH_TOOL] as any,
    response_format: SEARCH_RESPONSE_FORMAT as any, provider: { require_parameters: true } as any,
  } as any);
  const c = resp.choices?.[0];
  console.log("finish_reason:", c?.finish_reason, "| native:", c?.native_finish_reason,
    "| contentLen:", (c?.message?.content ?? "").length, "| topError:", resp.error ?? null);
  fs.writeFileSync("/tmp/opus_raw.json", JSON.stringify(resp, null, 2));
  console.log("full → /tmp/opus_raw.json");
}

async function viaWrapper() {
  try {
    const resp: any = await llm.create({
      model: MODEL, messages, tools: [WEB_SEARCH_TOOL] as any, response_format: SEARCH_RESPONSE_FORMAT as any,
    } as any);
    const content = resp.choices?.[0]?.message?.content ?? "";
    console.log(`✅ llm.create returned content (len=${content.length}): ${content.slice(0, 160)}`);
  } catch (err: any) {
    console.log(`💥 llm.create threw (this is the clear, correct failure): ${err?.message}`);
  }
}

(RAW ? rawDump() : viaWrapper());
