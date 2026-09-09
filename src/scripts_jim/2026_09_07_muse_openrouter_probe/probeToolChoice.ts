/**
 * Muse rejects `tool_choice: "required"`, which is what the Serper search loop
 * sends on turn 1. The loop forces that first call because some models
 * otherwise answer straight from the JSON schema without ever searching.
 *
 * So the question this probe answers is narrow: if we asked Muse with
 * `tool_choice: "auto"` instead, would it search anyway? It sends the loop's
 * real turn-1 shape several times and counts how often a tool call comes back.
 *
 * Run: bun run src/scripts_jim/2026_09_07_muse_openrouter_probe/probeToolChoice.ts
 */

import "dotenv/config";
import { llm } from "../../pipeline/llm/llm";
import { GOOGLE_SEARCH_TOOL, WEB_FETCH_TOOL } from "../../pipeline/tool-calling/tools";
import { SEARCH_RESPONSE_FORMAT } from "../../pipeline/prompts/simple-bot/searchAgent";

if (process.env.OPENROUTER_TESTING_KEY) {
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
}

const MODEL = "meta/muse-spark-1.3-contributor";
const SAMPLES = 5;

/** Close to what the loop actually sends: a claim worth checking, plus the
 *  instruction to search first that the real system prompt carries. */
const SYSTEM_PROMPT =
  "You fact-check claims for Community Notes. You have access to a google_search tool. " +
  "Issue search queries to gather evidence, then return your final findings as JSON. " +
  "You may call google_search multiple times. Stop calling tools and return JSON when you have enough evidence.";
const USER_MESSAGE =
  "Check this claim from a tweet: \"The Eiffel Tower was moved to Berlin in 2019.\" " +
  "Search for evidence before answering.";

async function sample(index: number) {
  const response = await llm.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_MESSAGE },
    ],
    tools: [GOOGLE_SEARCH_TOOL, WEB_FETCH_TOOL],
    tool_choice: "auto",
    response_format: SEARCH_RESPONSE_FORMAT,
  } as any);

  const message = response.choices?.[0]?.message;
  const toolCalls = message?.tool_calls ?? [];
  const cost = (response as any).usage?.cost ?? 0;
  if (toolCalls.length > 0) {
    const names = toolCalls.map((tc: any) => tc.function?.name).join(", ");
    console.log(`  ${index}. searched — called ${names}  ($${cost})`);
    return { searched: true, cost };
  }
  console.log(`  ${index}. answered without searching — ${String(message?.content ?? "").slice(0, 120)}  ($${cost})`);
  return { searched: false, cost };
}

async function main() {
  console.log(`Turn-1 shape with tool_choice="auto", ${SAMPLES} samples on ${MODEL}:\n`);
  let searched = 0;
  let totalCost = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const result = await sample(i);
    if (result.searched) searched++;
    totalCost += result.cost;
  }
  console.log(`\n${searched}/${SAMPLES} searched. Total cost $${totalCost.toFixed(6)}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
