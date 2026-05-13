/**
 * Re-run the searxng tool-calling loop for Mistral Medium 3.5 and Small 4,
 * printing the full message content + finish_reason on each turn so we
 * can see exactly why parseSearchJson rejected the final output.
 */

import "dotenv/config";
import OpenAI from "openai";
import { executeToolCall } from "../../pipeline/tool-calling/tools";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { withTweetLog, createTweetLog } from "../../pipeline/utils/tweetLog";
import { withBotConfig, DEFAULT_CONFIG } from "../../pipeline/ab-testing/botConfig";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const SYSTEM = `You investigate whether an X/Twitter post contains a factual error. Return JSON with { findings: string, correction_needed: boolean }.

You have access to a google_search tool. Issue search queries to gather evidence, then return your final findings as JSON. You may call google_search multiple times. Stop calling tools and return JSON when you have enough evidence.`;

const USER = `Tweet to fact-check:
@someone — "BREAKING: Scientists confirm the Great Wall of China is visible from the Moon with the naked eye."`;

const GOOGLE_SEARCH_TOOL: any = {
  type: "function",
  function: {
    name: "google_search",
    description: "Search the web via SearXNG.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "search_output",
    strict: true,
    schema: {
      type: "object",
      properties: {
        findings: { type: "string" },
        correction_needed: { type: "boolean" },
      },
      required: ["findings", "correction_needed"],
      additionalProperties: false,
    },
  },
};

const MODELS = ["mistralai/mistral-medium-3-5", "mistralai/mistral-small-2603"];

async function traceModel(model: string) {
  console.log(`\n========== ${model} ==========`);
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: USER },
  ];

  for (let turn = 1; turn <= 4; turn++) {
    const resp = await client.chat.completions.create({
      model,
      messages,
      tools: [GOOGLE_SEARCH_TOOL],
      response_format: RESPONSE_FORMAT,
    } as any);
    const choice = resp.choices?.[0];
    const msg = choice?.message;
    const content = msg?.content ?? "";
    const toolCalls = msg?.tool_calls ?? [];
    console.log(`\n--- turn ${turn} ---`);
    console.log(`finish_reason: ${choice?.finish_reason}`);
    console.log(`tool_calls: ${toolCalls.length}`);
    console.log(`content length: ${content.length}`);
    console.log(`content:\n${content}`);
    if (toolCalls.length) {
      messages.push(msg);
      for (const tc of toolCalls) {
        const fn = (tc as any).function?.name;
        const args = JSON.parse((tc as any).function?.arguments ?? "{}");
        console.log(`  → ${fn}(${JSON.stringify(args)})`);
        const result = await executeToolCall(fn, args);
        const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
        messages.push({ role: "tool", tool_call_id: (tc as any).id, content: output });
      }
      continue;
    }
    // Final turn: try to parse
    try {
      JSON.parse(content);
      console.log("→ JSON parses ✓");
    } catch (e: any) {
      console.log(`→ JSON.parse FAILED: ${e.message}`);
    }
    return;
  }
  console.log("\n(reached turn cap without final answer)");
}

async function main() {
  const log = createTweetLog();
  await withTweetLog(log, () =>
    withBotConfig({ ...DEFAULT_CONFIG, botId: "simple-bot" }, () =>
      withCostTracker(async () => {
        for (const model of MODELS) await traceModel(model);
      }),
    ),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
