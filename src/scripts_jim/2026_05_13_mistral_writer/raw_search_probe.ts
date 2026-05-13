/**
 * Direct OpenRouter call mirroring the searxng-loop final turn for the
 * two Mistral models that failed JSON-parse, so we can see finish_reason,
 * full content length, and token usage.
 */

import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const SYSTEM = `You investigate whether an X/Twitter post contains a factual error. Return JSON with { findings: string, correction_needed: boolean }.

You have access to a google_search tool. Issue search queries to gather evidence, then return your final findings as JSON. You may call google_search multiple times. Stop calling tools and return JSON when you have enough evidence.`;

const USER = `Tweet to fact-check:
@someone — "BREAKING: Scientists confirm the Great Wall of China is visible from the Moon with the naked eye."`;

// Fake a "tool result" so the model is forced to do the final synthesis turn.
const TOOL_RESULT = `Search results for "Great Wall of China visible from Moon naked eye":
1. NASA — "Despite the myth, the Great Wall of China is NOT visible from the Moon with the naked eye." https://www.nasa.gov/feature/goddard/2008/great-wall-of-china-visible-from-space
2. Scientific American — Chinese astronaut Yang Liwei confirmed he could not see the Wall from orbit. https://www.scientificamerican.com/article/is-chinas-great-wall-visible-from-space/
3. Wikipedia — Apollo astronauts Alan Bean and others all stated the Wall is not visible from the Moon. https://en.wikipedia.org/wiki/Great_Wall_of_China#Visibility_from_space`;

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

const MODELS = ["mistralai/mistral-medium-3-5", "mistralai/mistral-small-2603", "mistralai/mistral-large-2512"];

async function main(): Promise<void> {
  for (const model of MODELS) {
    console.log(`\n=== ${model} — single-shot with synthetic tool result ===`);
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: USER },
        { role: "assistant", content: "I will search for this.", tool_calls: [{ id: "call_1", type: "function", function: { name: "google_search", arguments: '{"query":"Great Wall of China visible from Moon"}' }}] } as any,
        { role: "tool", tool_call_id: "call_1", content: TOOL_RESULT } as any,
        { role: "user", content: "Stop searching. Return your final findings as JSON now." },
      ],
      response_format: RESPONSE_FORMAT,
    } as any);
    const choice = resp.choices?.[0];
    const content = choice?.message?.content ?? "";
    console.log(`finish_reason: ${choice?.finish_reason}`);
    console.log(`content length: ${content.length} chars`);
    console.log(`usage: ${JSON.stringify(resp.usage)}`);
    console.log(`content:\n${content}`);
    try {
      JSON.parse(content);
      console.log("→ parses as JSON ✓");
    } catch (e: any) {
      console.log(`→ JSON.parse FAILED: ${e.message}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
