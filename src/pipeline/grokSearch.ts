/**
 * Grok X Search
 *
 * Uses xAI's Grok to search X/Twitter for context around a tweet:
 * preceding tweets in thread, quoted tweets, and relevant replies.
 */

import { generateText } from "ai";
import { xai } from "./xai";

const PROMPTS = {
  search: (
    tweetUrl: string,
    tweetText: string,
  ) => `Search X/Twitter for tweets surrounding this specific tweet. Is it replying to any specific tweets, quoting any tweets, or are there notable replies?

Do not talk in general, nor offer commentary. Give the text of the preceding 0-3 tweets, the quoted tweet if any, and 0-3 relevant replies. Otherwise respond with nothing.

Tweet URL: ${tweetUrl}
Tweet text: "${tweetText}"

Output format:

### Preceding Tweets in thread

[Username, ID, tweet text/None if none present]

[Next entry if applicable]

### Quoted Tweet

[Username, ID, tweet text/None if none present]

### Replies

[Username, ID, tweet text/None if none present]

[Next entry if applicable]
`,
};

/**
 * Use Grok to search X for context around a tweet
 */
export async function searchXWithGrok(tweetId: string, tweetText: string, config: { model: string }): Promise<string> {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY not set - cannot use Grok X search");
  }

  const tweetUrl = `https://x.com/i/status/${tweetId}`;
  const prompt = PROMPTS.search(tweetUrl, tweetText);

  const { text } = await generateText({
    model: xai.responses(config.model) as any,
    prompt,
    tools: {
      x_search: xai.tools.xSearch({
        enableImageUnderstanding: true,
      }) as any,
    },
  });

  return text;
}

/**
 * Extract the quoted tweet section from Grok's output
 */
export function extractGrokQuotedTweet(grokOutput: string): string | null {
  const match = grokOutput.match(/### Quoted Tweet\s*\n([\s\S]*?)(?=\n###|$)/i);
  if (!match) return null;

  const content = match[1]?.trim() ?? null;
  if (!content || content.toLowerCase() === "none" || content === "[None]") return null;

  return content;
}

/**
 * Compare Grok's quoted tweet with our quotedPostContext.
 * Returns error message if there's a mismatch, null if OK.
 */
export function compareQuotedTweets(
  grokQuotedTweet: string | null,
  quotedPostContext: string | undefined,
): string | null {
  const hasGrokQt = grokQuotedTweet !== null;
  const hasOurQt = quotedPostContext !== undefined && quotedPostContext.trim() !== "";

  if (hasGrokQt && hasOurQt) {
    console.log(`[grokSearch] Quote tweet comparison:`);
    console.log(`  Grok found: ${grokQuotedTweet!.substring(0, 100)}...`);
    console.log(`  Our context: ${quotedPostContext!.substring(0, 100)}...`);
    return null;
  } else if (hasGrokQt && !hasOurQt) {
    const msg = `Quote tweet mismatch: Grok found a quoted tweet but we don't have quotedPostContext. Grok found: ${grokQuotedTweet}`;
    console.error(`[grokSearch] ⚠️ ${msg}`);
    return msg;
  } else if (!hasGrokQt && hasOurQt) {
    const msg = `Quote tweet mismatch: We have quotedPostContext but Grok didn't find a quoted tweet. Our context: ${quotedPostContext}`;
    console.error(`[grokSearch] ⚠️ ${msg}`);
    return msg;
  }

  return null;
}
