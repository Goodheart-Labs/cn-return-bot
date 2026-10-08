/**
 * Sonnet 5.5 or Opus 5.5 for the tag bot's search step, both at medium
 * reasoning? Runs the production search prompt three times per model on the two
 * example posts and counts the right answers and the web searches made. The
 * Mumbai post needs a note on its side claim; the GDP post needs none.
 *
 *   bun run src/scripts_jim/2026_10_05_x_tag_bot_plan/compareSearchModels.ts
 */

import "dotenv/config";
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;

import { readFileSync, writeFileSync } from "fs";
import { extractOpenRouterCost } from "../../pipeline/cost-tracking/pricing";
import { llm } from "../../pipeline/llm/llm";
import { SEARCH_PROMPTED_JSON_INSTRUCTION, SEARCH_SYSTEM_PROMPT } from "../../pipeline/prompts/simple-bot/searchAgent";
import { WEB_SEARCH_TOOL } from "../../pipeline/tool-calling/tools";
import { extractJsonObject } from "../../pipeline/utils/jsonOutput";

const MODELS = ["anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5"];
const RUNS_PER_MODEL = 3;
const OUTPUT_DIR = `${import.meta.dir}/output`;
const POSTS = [
  { name: "mumbai", expectNote: true, postContext: JSON.parse(readFileSync(`${OUTPUT_DIR}/examples_mumbai.json`, "utf8")).mumbai.postContext },
  { name: "gdp", expectNote: false, postContext: JSON.parse(readFileSync(`${OUTPUT_DIR}/examples_gdp.json`, "utf8")).gdp.postContext },
];

async function searchOnce(model: string, postContext: string) {
  const startMs = Date.now();
  const response: any = await llm.create({
    model,
    reasoning_effort: "medium",
    tools: [WEB_SEARCH_TOOL],
    messages: [
      { role: "system", content: `${SEARCH_SYSTEM_PROMPT}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}` },
      { role: "user", content: postContext },
    ],
  } as any);
  const raw = response.choices?.[0]?.message?.content ?? "";
  let correctionNeeded: boolean | null = null;
  try { correctionNeeded = JSON.parse(extractJsonObject(raw)).correction_needed; } catch { /* counted as unparseable */ }
  return {
    correctionNeeded,
    webSearches: response.usage?.server_tool_use_details?.web_search_requests ?? 0,
    costUsd: extractOpenRouterCost(response).cost,
    seconds: (Date.now() - startMs) / 1000,
  };
}

const jobs = MODELS.flatMap((model) => POSTS.flatMap((post) =>
  Array.from({ length: RUNS_PER_MODEL }, () => ({ model, post }))));
const results = await Promise.all(jobs.map(async ({ model, post }) => ({
  model, post: post.name, expectNote: post.expectNote, ...(await searchOnce(model, post.postContext)),
})));

writeFileSync(`${OUTPUT_DIR}/compare_search_models.json`, JSON.stringify(results, null, 2));
for (const model of MODELS) {
  for (const post of POSTS) {
    const runs = results.filter((r) => r.model === model && r.post === post.name);
    const right = runs.filter((r) => r.correctionNeeded === post.expectNote).length;
    const searched = runs.filter((r) => r.webSearches > 0).length;
    const cost = runs.reduce((sum, r) => sum + r.costUsd, 0) / runs.length;
    const seconds = runs.reduce((sum, r) => sum + r.seconds, 0) / runs.length;
    console.log(`${model.padEnd(28)} ${post.name.padEnd(7)} right ${right}/${runs.length}  searched ${searched}/${runs.length}  searches ${runs.map((r) => r.webSearches).join(",")}  mean $${cost.toFixed(3)}  ${seconds.toFixed(0)} s`);
  }
}
