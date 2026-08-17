/**
 * Pricing
 *
 * Model constants and cost-tracking helpers.
 * OpenRouter reports what a call cost in usage.cost, so those calls need no
 * calculation here. The xAI and native Gemini APIs report no cost at all, so we
 * work theirs out from the published per-token rates below.
 */

// --- Model constants ---

export const GROK_MODEL = "grok-4-fast";
export const PERPLEXITY_MODEL = "perplexity/sonar";
export const GEMINI_MODEL = "google/gemini-3-flash-preview";

// --- Grok pricing ---
// The rates come from https://docs.x.ai/docs/models. xAI bills every xSearch tool
// call at the same flat rate, whichever model made the call.

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

// --- Gemini native API pricing ---
// The rates come from cloud.google.com/vertex-ai/pricing. The native Gemini API
// returns no usage.cost the way OpenRouter does, so src/pipeline/llm/gemini.ts
// works the cost out from these numbers.
const GEMINI_PRICING: Record<string, { in: number; out: number; searchPerCall: number }> = {
  "gemini-3-flash-preview": { in: 0.50, out: 3.00,  searchPerCall: 0.014 },
  "gemini-3.1-pro-preview": { in: 2.00, out: 12.00, searchPerCall: 0.014 },
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

