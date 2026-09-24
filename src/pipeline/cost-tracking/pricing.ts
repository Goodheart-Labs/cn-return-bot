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

/** Every model that a native_grok A/B arm can select needs a row here. A model
 *  that is missing records its runs at cost 0, which quietly understates spend
 *  and makes the cost-per-helpful-note comparison between arms wrong rather than
 *  merely incomplete. `pricingCoverage.test.ts` fails when an arm has no row.
 *  These are the rates for requests under 200k tokens, which is every request we
 *  make. Above that xAI charges double. */
export const GROK_PRICING: Record<string, { in: number; out: number }> = {
  "grok-4-fast": { in: 0.20,  out: 0.50 },
  "grok-4.3":    { in: 1.25,  out: 2.50 },
  "grok-4.5":    { in: 2.00,  out: 6.00 },
  "grok-4.6":    { in: 2.00,  out: 6.00 },
};
const GROK_XSEARCH_PER_CALL = 0.005;

// --- Serper pricing ---
// Serper bills one credit for each search that returns up to 10 results, and we
// always ask for 10. We are on the $50 plan, which buys 50,000 credits. A request
// that fails is not billed, so callers record this cost only for a search that
// returned.
const SERPER_PLAN_PRICE_USD = 50;
const SERPER_PLAN_CREDITS = 50_000;
export const SERPER_COST_PER_SEARCH = SERPER_PLAN_PRICE_USD / SERPER_PLAN_CREDITS;

// --- Groq Whisper pricing ---
// Groq bills whisper-large-v3 at $0.111 per hour of audio, and a request shorter
// than 10 seconds is billed as 10 seconds (console.groq.com/docs/speech-to-text,
// read 2026-09-24).
const WHISPER_USD_PER_AUDIO_HOUR = 0.111;
const WHISPER_MIN_BILLED_SECONDS = 10;
const SECONDS_PER_HOUR = 3600;

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
export const GEMINI_PRICING: Record<string, { in: number; out: number; searchPerCall: number }> = {
  "gemini-3-flash-preview": { in: 0.50, out: 3.00,  searchPerCall: 0.014 },
  "gemini-3.1-pro-preview": { in: 2.00, out: 12.00, searchPerCall: 0.014 },
  "gemini-3.8-flash":       { in: 0.75, out: 3.75,  searchPerCall: 0.014 },
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

/** The cost of one Serper search. It uses no tokens, only the per-search fee. */
export function serperSearchCost(): TokenCost {
  return { input_tokens: 0, output_tokens: 0, cost: SERPER_COST_PER_SEARCH };
}

/** The cost of transcribing an audio clip of the given length with Groq Whisper. */
export function whisperTranscriptionCost(audioSeconds: number): TokenCost {
  const billedSeconds = Math.max(audioSeconds, WHISPER_MIN_BILLED_SECONDS);
  return { input_tokens: 0, output_tokens: 0, cost: (billedSeconds / SECONDS_PER_HOUR) * WHISPER_USD_PER_AUDIO_HOUR };
}

export function emptyTokenCost(): TokenCost {
  return { input_tokens: 0, output_tokens: 0, cost: 0 };
}

export function addTokenCost(acc: TokenCost, add: TokenCost): void {
  acc.input_tokens += add.input_tokens;
  acc.output_tokens += add.output_tokens;
  acc.cost += add.cost;
}

