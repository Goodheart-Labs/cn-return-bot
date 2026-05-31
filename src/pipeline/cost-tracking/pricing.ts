/**
 * Pricing
 *
 * Model constants and cost-tracking helpers.
 * OpenRouter returns usage.cost directly; only Grok (xAI) needs manual calculation.
 */

// --- Model constants ---

export const GROK_MODEL = "grok-4-fast";
export const PERPLEXITY_MODEL = "perplexity/sonar";
export const GEMINI_MODEL = "google/gemini-3-flash-preview";

// --- Grok pricing (xAI doesn't return cost in response) ---
// Per https://docs.x.ai/docs/models. Search call price applies regardless of
// the model (xAI bills xSearch tool calls at a flat per-call rate).

const GROK_PRICING: Record<string, { in: number; out: number }> = {
  "grok-4-fast": { in: 0.20,  out: 0.50 },
  "grok-4.3":    { in: 1.25,  out: 2.50 },
};
const GROK_XSEARCH_PER_CALL = 0.005;

// --- Types ---

export interface TokenCost {
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

// --- Helpers ---

export function extractOpenRouterCost(response: any): TokenCost {
  const usage = response?.usage;
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
    cost: usage?.cost ?? 0,
  };
}

export function calculateGrokCost(
  inputTokens: number,
  outputTokens: number,
  searchCalls: number,
  model: string = GROK_MODEL,
): TokenCost {
  const p = GROK_PRICING[model];
  if (!p) {
    console.warn(`[pricing] No Grok pricing for "${model}" — recording cost as 0`);
    return { input_tokens: inputTokens, output_tokens: outputTokens, cost: 0 };
  }
  const tokenCost =
    (inputTokens / 1_000_000) * p.in +
    (outputTokens / 1_000_000) * p.out;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost: tokenCost + searchCalls * GROK_XSEARCH_PER_CALL,
  };
}

// --- Gemini native API pricing (cloud.google.com/vertex-ai/pricing) ---
// Used by src/pipeline/llm/gemini.ts since the native API does not return
// usage.cost like OpenRouter does.
const GEMINI_PRICING: Record<string, { in: number; out: number; searchPerCall: number }> = {
  "gemini-3-flash-preview": { in: 0.50, out: 3.00,  searchPerCall: 0.014 },
  "gemini-3-pro":           { in: 2.00, out: 12.00, searchPerCall: 0.014 },
};

export function calculateGeminiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  searchCalls: number,
): TokenCost {
  const p = GEMINI_PRICING[model];
  if (!p) {
    console.warn(`[pricing] No Gemini pricing for "${model}" — recording cost as 0`);
    return { input_tokens: inputTokens, output_tokens: outputTokens, cost: 0 };
  }
  const tokenCost =
    (inputTokens / 1_000_000) * p.in +
    (outputTokens / 1_000_000) * p.out;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost: tokenCost + searchCalls * p.searchPerCall,
  };
}

export function emptyTokenCost(): TokenCost {
  return { input_tokens: 0, output_tokens: 0, cost: 0 };
}

export function addTokenCost(acc: TokenCost, add: TokenCost): void {
  acc.input_tokens += add.input_tokens;
  acc.output_tokens += add.output_tokens;
  acc.cost += add.cost;
}

