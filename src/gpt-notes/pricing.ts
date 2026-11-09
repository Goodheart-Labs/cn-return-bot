/* What one request to GPT-6.1 Terra costs, from the usage OpenAI reports.
 * The prices are OpenAI's list prices from https://developers.openai.com/api/docs/pricing
 * as of 2026-11-02, in dollars per million tokens. */

/** OpenAI's name for the standard tier is "default". "flex" is half the price,
 *  but OpenAI may answer slowly or turn a request away when it is busy. */
export type ServiceTier = "default" | "flex";

const PRICES_PER_MILLION: Record<ServiceTier, { input: number; cachedInput: number; write30m: number; write12h: number; output: number }> = {
  default: { input: 1, cachedInput: 0.05, write30m: 1.25, write12h: 2.5, output: 5 },
  flex: { input: 0.5, cachedInput: 0.025, write30m: 0.625, write12h: 1.25, output: 2.5 },
};

/** A request with more input tokens than this is billed at the long-context
 *  rate as a whole: every input price doubles and the output price rises by
 *  half. */
export const LONG_CONTEXT_INPUT_TOKENS = 272_000;
const LONG_CONTEXT_INPUT_FACTOR = 2;
const LONG_CONTEXT_OUTPUT_FACTOR = 1.5;

/** Each web search costs this on top of its tokens, on every tier. Opening a
 *  page and searching inside it cost no call fee. */
export const WEB_SEARCH_CALL_USD = 0.01;

export interface RequestUsage {
  inputTokens: number;
  /** Input tokens read from the cache. */
  cachedTokens: number;
  /** Input tokens written to the cache, by how long the cache keeps them. */
  write30mTokens: number;
  write12hTokens: number;
  /** Output tokens, including the hidden reasoning. */
  outputTokens: number;
  webSearches: number;
}

export function requestCostUsd(usage: RequestUsage, tier: ServiceTier): number {
  const price = PRICES_PER_MILLION[tier];
  const isLongContext = usage.inputTokens > LONG_CONTEXT_INPUT_TOKENS;
  const inputFactor = isLongContext ? LONG_CONTEXT_INPUT_FACTOR : 1;
  const outputFactor = isLongContext ? LONG_CONTEXT_OUTPUT_FACTOR : 1;
  // Each input token is billed once: as a cache read, as a cache write, or at
  // the ordinary rate.
  const uncachedTokens = usage.inputTokens - usage.cachedTokens - usage.write30mTokens - usage.write12hTokens;
  const inputUsd =
    uncachedTokens * price.input + usage.cachedTokens * price.cachedInput + usage.write30mTokens * price.write30m + usage.write12hTokens * price.write12h;
  const tokensUsd = (inputUsd * inputFactor + usage.outputTokens * price.output * outputFactor) / 1_000_000;
  return tokensUsd + usage.webSearches * WEB_SEARCH_CALL_USD;
}
