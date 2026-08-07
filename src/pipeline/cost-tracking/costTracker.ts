/**
 * Cost Tracker
 *
 * Append-only cost tracking through AsyncLocalStorage. Each LLM call appends an
 * entry with a dot-notation name. One aggregation function at the end builds the
 * tree and logs everything.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { llm } from "../llm/llm";
import { tryGeminiFreeChat } from "../llm/geminiChatAdapter";
import { getTweetLog } from "../utils/tweetLog";
import { type TokenCost, extractOpenRouterCost, addTokenCost, emptyTokenCost } from "./pricing";

// --- Types ---

export interface ToolCallCost {
  name: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

export interface LlmCallCost {
  name: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  tools: ToolCallCost[];
}

// --- AsyncLocalStorage ---

const costStorage = new AsyncLocalStorage<LlmCallCost[]>();

export function withCostTracker<T>(fn: () => T): T {
  return costStorage.run([], fn);
}

export function getCostTracker(): LlmCallCost[] {
  return costStorage.getStore() ?? [];
}

export function trackLlmCall(entry: LlmCallCost): void {
  getCostTracker().push(entry);
}

// --- Tracked LLM call ---

export async function trackedLlmCreate(
  name: string,
  params: Parameters<typeof llm.create>[0],
): Promise<{ response: any; costEntry: LlmCallCost }> {
  // A Gemini call that uses no tools prefers Google's free native key. A null
  // result means the call was not routable that way, or that the free key
  // failed. In both cases we fall through to OpenRouter.
  const native = await tryGeminiFreeChat(params);
  if (native) {
    return { response: native.response, costEntry: { name, ...native.cost, tools: [] } };
  }

  const response = await llm.create(params);
  const cost = extractOpenRouterCost(response);
  const costEntry: LlmCallCost = { name, ...cost, tools: [] };
  return { response, costEntry };
}

// --- Aggregation ---

function entryCost(entry: LlmCallCost): TokenCost {
  const cost = { input_tokens: entry.input_tokens, output_tokens: entry.output_tokens, cost: entry.cost };
  for (const tool of entry.tools) {
    cost.cost += tool.cost;
  }
  return cost;
}

/**
 * Sum all tracked cost entries, write the breakdown to the tweet log, and
 * return the total. Bots call this once at the end of their pipeline and
 * attach `total.cost` to the PipelineResult so processTweet can persist it.
 *
 * Returns null when nothing was tracked (no LLM calls made, or no cost-tracker
 * scope is active).
 */
export function aggregateAndLogCosts(): TokenCost | null {
  const entries = getCostTracker();
  if (!entries.length) return null;

  // Group the entries by the first segment of their dot-notation name. An entry
  // named "agent.turn3" lands in the "agent" group.
  const groups: Record<string, TokenCost> = {};
  const total = emptyTokenCost();

  for (const entry of entries) {
    const cost = entryCost(entry);
    addTokenCost(total, cost);

    const group = entry.name.split(".")[0]!;
    if (!groups[group]) groups[group] = emptyTokenCost();
    addTokenCost(groups[group]!, cost);
  }

  const log = getTweetLog();
  if (log) {
    log.set("costs.entries", entries);
    log.set("costs.groups", groups);
    log.set("costs.total", total);
  }

  return total;
}
