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

const GROK_INPUT_PER_MTOK = 0.20;
const GROK_OUTPUT_PER_MTOK = 0.50;
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
): TokenCost {
  const tokenCost =
    (inputTokens / 1_000_000) * GROK_INPUT_PER_MTOK +
    (outputTokens / 1_000_000) * GROK_OUTPUT_PER_MTOK;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost: tokenCost + searchCalls * GROK_XSEARCH_PER_CALL,
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
