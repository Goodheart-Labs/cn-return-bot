/**
 * Research Loop
 *
 * Multi-round research using Claude: initial fact-check search,
 * then follow-up rounds to analyze gaps and gather more evidence.
 *
 * NOTE: This module uses OpenAI-compatible `llm.create` (via OpenRouter),
 * while grokSearch.ts uses Vercel AI SDK's `generateText`. Error handling
 * and response parsing differ between the two code paths.
 */

import { llm } from "../llm/llm";
import { logLlmCall } from "../utils/tweetLog";

const PROMPTS = {
  firstSearch: (tweetText: string, quotedTweet: string) =>
    `Research this social media post to fact-check it. Find relevant sources and URLs that could support or refute the claims made.

POST TO FACT-CHECK:
${tweetText}
${quotedTweet}
`,

  analyzeGaps: (
    tweetText: string,
    quotedTweet: string,
    grokContext: string,
    iteration: number,
    currentResearch: string
  ) =>
    `You are analyzing research about a tweet to figure out what is going on with it and if it is misleading.

POST TO FACT-CHECK:
${tweetText}
${quotedTweet}

CURRENT RESEARCH (after ${iteration} round${iteration > 1 ? "s" : ""}):
${currentResearch}

Does the current research make sense? Do you understand what is going on in both the tweet and in reality? Use web search to find  important aspects that confuse you.

Grok's X search shows surrounding context - take it with a pinch of salt as it's not always accurate.

GROK'S X SEARCH (surrounding tweets, replies, quoted tweet):
${grokContext}

Output URLs to support claims.

At the end after your answer, write if you think there are still major questions in relation to the tweet that need answering in the following format.

RESEARCH_REQUEST: [If YES, what to search for next. If NO, write "None"]`,
};

/**
 * Initial fact-check search using Claude
 */
export async function claudeFirstSearch(
  tweetText: string,
  config: { model: string },
  quotedPostContext?: string
): Promise<string> {
  const quoteContext = quotedPostContext
    ? `\n\nQUOTED TWEET:\n${quotedPostContext}`
    : "";
  const prompt = PROMPTS.firstSearch(tweetText, quoteContext);

  const messages = [{ role: "user" as const, content: prompt }];
  const startMs = Date.now();
  const result = await llm.create({ model: config.model, messages });
  const response = result.choices?.[0]?.message?.content ?? "";
  logLlmCall("research.initial", messages, response, Date.now() - startMs);
  return response;
}

export interface FollowUpResult {
  content: string;
  hasGaps: boolean;
  researchRequest: string;
  urls: string[];
}

/**
 * Follow-up research: analyzes current research and identifies gaps.
 * Returns the full response plus extracted metadata.
 */
export async function followUpResearch(
  tweetText: string,
  currentResearch: string,
  iteration: number,
  config: { model: string },
  quotedPostContext?: string,
  grokContext?: string
): Promise<FollowUpResult> {
  const quoteContext = quotedPostContext
    ? `\n\nQUOTED TWEET:\n${quotedPostContext}`
    : "";
  const prompt = PROMPTS.analyzeGaps(
    tweetText,
    quoteContext,
    grokContext || "None",
    iteration,
    currentResearch
  );

  const messages = [{ role: "user" as const, content: prompt }];
  const startMs = Date.now();
  const result = await llm.create({ model: config.model, messages });
  const content = result.choices?.[0]?.message?.content ?? "";
  logLlmCall(`research.followUp${iteration}`, messages, content, Date.now() - startMs);

  const requestMatch = content.match(/RESEARCH_REQUEST:\s*(.+?)$/is);
  const researchRequest = requestMatch?.[1]?.trim() || "None";

  const urlMatches = content.match(/https?:\/\/[^\s\])"'>]+/g) || [];
  const urls = [...new Set(urlMatches.map((u) => u.replace(/[.,;:!?)]+$/, "")))];

  const hasGaps =
    researchRequest.toLowerCase() !== "none" && researchRequest !== "";

  return { content, hasGaps, researchRequest, urls };
}
