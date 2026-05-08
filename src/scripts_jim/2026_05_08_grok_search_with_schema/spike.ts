/**
 * Phase 0 for native Grok search: which call shape gives us xSearch + JSON?
 *
 * (A) Vercel AI SDK generateText + xSearch + JSON in prompt — works but loose.
 * (B) Vercel AI SDK generateText + experimental_output schema — does it accept
 *     tools at the same time?
 * (C) OpenAI SDK pointed at api.x.ai/v1 + response_format json_schema —
 *     does xAI's OpenAI-compat endpoint accept search tools?
 */

import "dotenv/config";
import { generateText } from "ai";
import { z } from "zod";
import { xai } from "../../pipeline/llm/xai";
import OpenAI from "openai";

const PROMPT = `You are fact-checking. Use search to verify.
Tweet: "BREAKING: Tokyo's population just hit 8 million. Massive shrinkage!"
Return strict JSON: { findings: string with full URLs inline, correction_needed: boolean }`;

const SCHEMA = z.object({
  findings: z.string(),
  correction_needed: z.boolean(),
});

async function tryGenerateTextPlusJsonPrompt(): Promise<void> {
  console.log("\n=== A: generateText + xSearch + JSON in prompt ===");
  try {
    const { text, usage, steps } = await generateText({
      model: xai.responses("grok-4-fast") as any,
      prompt: PROMPT,
      tools: { x_search: xai.tools.xSearch({ enableImageUnderstanding: true }) as any },
    });
    console.log("text (first 800):", text.slice(0, 800));
    console.log("usage:", usage);
    console.log("search calls:", steps?.reduce((n, s) => n + (s.toolCalls?.filter((tc) => tc.toolName === "x_search").length ?? 0), 0));
    try {
      const cleaned = text.replace(/^```json\n?|\n?```$/g, "").trim();
      console.log("parsed:", JSON.parse(cleaned));
    } catch (err: any) {
      console.log("parse failed:", err.message);
    }
  } catch (err: any) {
    console.log("FAILED:", err.message?.slice(0, 800));
  }
}

async function tryExperimentalOutput(): Promise<void> {
  console.log("\n=== B: generateText + experimental_output + xSearch ===");
  try {
    const result = await generateText({
      model: xai.responses("grok-4-fast") as any,
      prompt: PROMPT,
      tools: { x_search: xai.tools.xSearch({ enableImageUnderstanding: true }) as any },
      experimental_output: { schema: SCHEMA } as any,
    } as any);
    console.log("text:", result.text?.slice(0, 400));
    console.log("experimental_output:", JSON.stringify((result as any).experimental_output)?.slice(0, 500));
  } catch (err: any) {
    console.log("FAILED:", err.message?.slice(0, 800));
  }
}

async function tryOpenAICompat(): Promise<void> {
  console.log("\n=== C: OpenAI SDK against api.x.ai with response_format ===");
  const client = new OpenAI({
    baseURL: "https://api.x.ai/v1",
    apiKey: process.env.XAI_API_KEY,
  });

  // xAI's "live search" is enabled via search_parameters in extra_body, not via tools.
  try {
    const r = await client.chat.completions.create({
      model: "grok-4-fast",
      messages: [{ role: "user", content: PROMPT }],
      response_format: {
        type: "json_schema" as any,
        json_schema: {
          name: "fact_check",
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
      } as any,
      // xAI Live Search per https://docs.x.ai/docs/guides/live-search
      // (passed through OpenAI SDK as a non-standard field)
      // @ts-ignore
      search_parameters: { mode: "auto" },
    } as any);
    const msg = r.choices[0]?.message;
    console.log("content (first 800):", msg?.content?.slice(0, 800));
    console.log("usage:", JSON.stringify(r.usage));
    try {
      console.log("parsed:", JSON.parse(msg?.content ?? "{}"));
    } catch (err: any) {
      console.log("parse failed:", err.message);
    }
  } catch (err: any) {
    console.log("FAILED:", err.status, err.message?.slice(0, 600));
    console.log("body:", JSON.stringify(err.error)?.slice(0, 600));
  }
}

async function main(): Promise<void> {
  if (!process.env.XAI_API_KEY) {
    console.error("XAI_API_KEY not set");
    process.exit(1);
  }
  await tryOpenAICompat();
  await tryGenerateTextPlusJsonPrompt();
  await tryExperimentalOutput();
}

main();
