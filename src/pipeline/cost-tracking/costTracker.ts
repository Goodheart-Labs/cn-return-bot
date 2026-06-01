/**
 * Cost Tracker
 *
 * Append-only cost tracking via AsyncLocalStorage. Each LLM call appends an entry
 * with a dot-notation name. One aggregation function at the end builds the tree
 * and logs everything.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { llm } from "../llm/llm";
import { getTweetLog, formatLlmMessages } from "../utils/tweetLog";
import { type TokenCost, extractOpenRouterCost, addTokenCost, emptyTokenCost } from "./pricing";

// Cap so a single call's flattened input can't bloat the pipeline_runs JSONB.
// Injected reference docs are ~2KB and sit at the front of the message, so this
// always preserves them; only very long raw search dumps get truncated.
const MAX_LLM_INPUT_CHARS = 16000;

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

/** Record the call's flattened input (system + user messages, multimodal-safe)
 *  under `llm_inputs.<name>` so every LLM call's prompt — including any injected
 *  reference document — is inspectable in the tweet log / dashboard. */
function logLlmInput(name: string, params: Parameters<typeof llm.create>[0]): void {
  const log = getTweetLog();
  const messages = (params as { messages?: unknown[] }).messages;
  if (!log || !Array.isArray(messages)) return;
  log.set(`llm_inputs.${name}`, formatLlmMessages(messages).slice(0, MAX_LLM_INPUT_CHARS));
}

export async function trackedLlmCreate(
  name: string,
  params: Parameters<typeof llm.create>[0],
): Promise<{ response: any; costEntry: LlmCallCost }> {
  logLlmInput(name, params);

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

  const log = getTweetLog();
  if (log) {
    log.set("costs.entries", entries);
    log.set("costs.groups", groups);
    log.set("costs.total", total);
  }

  return total;
}
