/**
 * Cost Tracker
 *
 * Append-only cost tracking via AsyncLocalStorage. Each LLM call appends an entry
 * with a dot-notation name. One aggregation function at the end builds the tree
 * and logs everything.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { llm } from "../llm/llm";
import { getTweetLog } from "./tweetLog";
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

export function aggregateAndLogCosts(): void {
  const entries = getCostTracker();
  const log = getTweetLog();
  if (!log || !entries.length) return;

  // Group by first path segment of the entry name (e.g. "search", "writer", "agent.turn3").
  const groups: Record<string, TokenCost> = {};
  const total = emptyTokenCost();

  for (const entry of entries) {
    const cost = entryCost(entry);
    addTokenCost(total, cost);

    const group = entry.name.split(".")[0]!;
    if (!groups[group]) groups[group] = emptyTokenCost();
    addTokenCost(groups[group]!, cost);
  }

  log.set("costs.entries", entries);
  log.set("costs.groups", groups);
  log.set("costs.total", total);
}
