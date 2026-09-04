/**
 * Verifies that each model we want to add as an A/B arm actually accepts the
 * parameters our pipeline sends.
 *
 * The risk this checks for is specific. Every OpenRouter call we make sets
 * `provider: { require_parameters: true }` (see src/pipeline/llm/llm.ts), which
 * tells OpenRouter to route only to providers that honour every parameter in the
 * request. When a model does not advertise support for one of them, the request
 * does not degrade quietly. It fails with "No endpoints found that can handle the
 * requested parameters". That is how Perplexity Sonar was found to be unusable
 * with json_schema, and it is why a new arm has to be tried before it ships.
 *
 * The script imports the real client and the real response formats rather than
 * copies, so a pass here means the production call shape works.
 *
 * Run: bun run src/scripts_jim/2026_09_01_model_evaluation/verifyModels.ts
 */

import "dotenv/config";
import { llm } from "../../pipeline/llm/llm";
import { WRITER_RESPONSE_FORMAT } from "../../pipeline/prompts/simple-bot/writer";
import { SEARCH_RESPONSE_FORMAT } from "../../pipeline/prompts/simple-bot/searchAgent";
import { GOOGLE_SEARCH_TOOL, WEB_FETCH_TOOL } from "../../pipeline/tool-calling/tools";
import { xaiNativeGenerate } from "../../pipeline/llm/xai";
import { geminiNativeGenerate } from "../../pipeline/llm/gemini";

/** Kept tiny on purpose. We are testing whether the request shape is accepted,
 *  not whether the answer is any good, so every call is a few hundred tokens. */
const WRITER_PROBE = "Reply with a one-sentence note about the sky being blue, citing https://example.com.";
const SEARCH_PROBE = "Search for the current population of Iceland, then report your findings.";

type Check = { model: string; shape: string; ok: boolean; detail: string };

const results: Check[] = [];

function record(model: string, shape: string, ok: boolean, detail: string) {
  results.push({ model, shape, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${model.padEnd(34)} ${shape.padEnd(22)} ${detail}`);
}

function errorText(err: any): string {
  const status = err?.status ?? err?.response?.status ?? "?";
  return `${status} ${String(err?.message ?? err).slice(0, 220)}`;
}

/** The writer stage: one JSON call with a strict json_schema response format. */
async function checkWriterShape(model: string) {
  try {
    const response = await llm.create({
      model,
      messages: [{ role: "user", content: WRITER_PROBE }],
      response_format: WRITER_RESPONSE_FORMAT,
    } as any);
    const content = response.choices?.[0]?.message?.content ?? "";
    // A strict schema should give us parseable JSON with no markdown fence. If a
    // provider ignored the schema, this is where it shows up.
    JSON.parse(content);
    record(model, "writer json_schema", true, `parsed ok, cost $${(response as any).usage?.cost ?? 0}`);
  } catch (err: any) {
    record(model, "writer json_schema", false, errorText(err));
  }
}

/** The Serper search loop, turn 1: tools attached and a tool call forced. */
async function checkSearchToolsForced(model: string) {
  try {
    const response = await llm.create({
      model,
      messages: [{ role: "user", content: SEARCH_PROBE }],
      tools: [GOOGLE_SEARCH_TOOL, WEB_FETCH_TOOL],
      tool_choice: "required",
    } as any);
    const toolCalls = response.choices?.[0]?.message?.tool_calls ?? [];
    if (toolCalls.length === 0) throw new Error("tool_choice=required returned no tool call");
    record(model, "search tools forced", true, `called ${(toolCalls[0] as any).function?.name}`);
  } catch (err: any) {
    record(model, "search tools forced", false, errorText(err));
  }
}

/** The Serper search loop, turns 2 and later: tools plus the json_schema
 *  response format at the same time. This pairing is the one that breaks most
 *  often, so it gets its own check. */
async function checkSearchToolsPlusSchema(model: string) {
  try {
    const response = await llm.create({
      model,
      messages: [{ role: "user", content: SEARCH_PROBE }],
      tools: [GOOGLE_SEARCH_TOOL, WEB_FETCH_TOOL],
      tool_choice: "auto",
      response_format: SEARCH_RESPONSE_FORMAT,
    } as any);
    const message = response.choices?.[0]?.message;
    const madeToolCall = (message?.tool_calls?.length ?? 0) > 0;
    // Either answer is fine here. The model may search first or answer straight
    // away. We only need the request itself to be accepted.
    if (!madeToolCall) JSON.parse(message?.content ?? "");
    record(model, "search tools+schema", true, madeToolCall ? "chose a tool call" : "returned schema JSON");
  } catch (err: any) {
    record(model, "search tools+schema", false, errorText(err));
  }
}

/** Grok search does not go through OpenRouter. It uses the native xAI API, so it
 *  is checked against that API with the same xSearch tool the pipeline enables. */
async function checkGrokNative(model: string) {
  try {
    const result = await xaiNativeGenerate({
      model,
      userMessage: SEARCH_PROBE,
      enableXSearch: true,
      responseSchema: {
        type: "object",
        properties: { findings: { type: "string" }, correction_needed: { type: "boolean" } },
        required: ["findings", "correction_needed"],
      },
    } as any);
    if (!result.parsed) throw new Error(`no parseable JSON: ${result.text.slice(0, 120)}`);
    record(`x-ai/${model}`, "native xAI xSearch", true, `searchCalls=${result.searchCalls}, cost $${result.cost.cost}`);
  } catch (err: any) {
    record(`x-ai/${model}`, "native xAI xSearch", false, errorText(err));
  }
}

/** Gemini search likewise runs on Google's native API with googleSearch. */
async function checkGeminiNative(model: string) {
  try {
    const result = await geminiNativeGenerate({
      model,
      userMessage: SEARCH_PROBE,
      enableGoogleSearch: true,
    });
    if (!result.text) throw new Error("empty response text");
    record(`google/${model}`, "native googleSearch", true, `cost $${result.cost.cost}`);
  } catch (err: any) {
    record(`google/${model}`, "native googleSearch", false, errorText(err));
  }
}

/** The free half of the check. `provider.require_parameters` routes on what a
 *  model advertises in OpenRouter's model list, so reading that list tells us in
 *  advance whether a request naming these parameters can find an endpoint at all.
 *  It costs nothing and needs no credit, which matters when the key is capped.
 *  A live call is still the stronger evidence, because a model can advertise a
 *  parameter and still handle it badly. */
async function checkAdvertisedParameters(models: string[], needed: string[]) {
  const response = await fetch("https://openrouter.ai/api/v1/models");
  const list = (await response.json()).data as any[];
  const byId = new Map(list.map((m) => [m.id, m]));

  for (const model of models) {
    const entry = byId.get(model);
    if (!entry) {
      record(model, "advertised params", false, "model id not found in the OpenRouter list");
      continue;
    }
    const supported: string[] = entry.supported_parameters ?? [];
    const missing = needed.filter((p) => !supported.includes(p));
    const price = `$${(Number(entry.pricing.prompt) * 1e6).toFixed(3)}/$${(Number(entry.pricing.completion) * 1e6).toFixed(3)}`;
    record(
      model,
      "advertised params",
      missing.length === 0,
      missing.length === 0 ? `has ${needed.join(", ")} — ${price}` : `missing ${missing.join(", ")}`,
    );
  }
}

async function main() {
  console.log("Verifying candidate models against the parameter shapes the pipeline sends.\n");

  console.log("--- Advertised parameter support (free, no credit needed) ---");
  // Writer arms need a strict json_schema response format and nothing else.
  await checkAdvertisedParameters(
    ["anthropic/claude-fable-5.1", "meta/muse-spark-1.3-contributor", "google/gemini-3.8-flash"],
    ["response_format", "structured_outputs"],
  );
  // Searxng search arms need tools and tool_choice as well, because the loop
  // attaches both alongside the schema from turn 2 onwards.
  await checkAdvertisedParameters(
    ["meta/muse-spark-1.3-contributor", "z-ai/glm-5.3", "z-ai/glm-5.3-flash"],
    ["response_format", "structured_outputs", "tools", "tool_choice"],
  );

  if (process.env.SKIP_LIVE_CHECKS) {
    console.log("\nSKIP_LIVE_CHECKS is set, so the paid calls are skipped.");
    summarize();
    return;
  }

  console.log("\n--- Writer arms (OpenRouter, strict json_schema) ---");
  for (const model of [
    "anthropic/claude-fable-5.1",
    "meta/muse-spark-1.3-contributor",
    "google/gemini-3.8-flash",
  ]) {
    await checkWriterShape(model);
  }

  console.log("\n--- Search arms on the Serper path (OpenRouter, tools) ---");
  for (const model of [
    "meta/muse-spark-1.3-contributor",
    "z-ai/glm-5.3",
    "z-ai/glm-5.3-flash",
  ]) {
    await checkSearchToolsForced(model);
    await checkSearchToolsPlusSchema(model);
  }

  console.log("\n--- Search arms on native vendor APIs (not OpenRouter) ---");
  await checkGrokNative("grok-4.6");
  await checkGeminiNative("gemini-3.8-flash");

  summarize();
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  ${f.model} [${f.shape}]: ${f.detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
