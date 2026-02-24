/**
 * Enriched Search
 *
 * Combines Perplexity web search with Grok X search in parallel.
 * Grok provides real-time X/Twitter context (thread, quoted tweets, replies)
 * while Perplexity provides web-wide fact-checking sources.
 *
 * Grok failure is non-fatal — if xAI is unavailable, continues with Perplexity only.
 */

import { versionOneFn as perplexitySearch } from "./searchContextGoal";
import { searchXWithGrok } from "./grokSearch";

export async function enrichedSearch(
  input: { text: string; media: string[]; searchResults: string; retweetContext?: string },
  config: { perplexityModel: string; grokModel: string },
  tweetId: string
) {
  const [perplexityResult, grokResult] = await Promise.all([
    perplexitySearch(input, { model: config.perplexityModel }),
    searchXWithGrok(tweetId, input.text, { model: config.grokModel })
      .catch((err) => {
        console.warn(`[enrichedSearch] Grok search failed (continuing without it):`, err?.message);
        return null;
      }),
  ]);

  const combinedSearch = grokResult
    ? `--- X/Twitter Context (via Grok) ---\n${grokResult}\n\n--- Web Research ---\n${perplexityResult.searchResults}`
    : perplexityResult.searchResults;

  return {
    ...perplexityResult,
    searchResults: combinedSearch,
  };
}
