/**
 * Agent Comments
 *
 * Pre-loop Grok call to fetch representative comments/replies under a tweet.
 * Provides the agent with reader reactions without burning grok_search calls.
 */

import { generateText } from "ai";
import { xai } from "../llm/xai";
import { getTweetLog } from "../utils/tweetLog";
import {
  GROK_MODEL,
  calculateGrokCost,
  emptyTokenCost,
  type TokenCost,
} from "./agentPricing";

export interface CommentsResult {
  comments: string;
  cost: TokenCost;
}

export async function fetchTweetComments(
  tweetId: string,
  tweetText: string,
): Promise<CommentsResult> {
  const log = getTweetLog();

  if (!process.env.XAI_API_KEY) {
    return { comments: "", cost: emptyTokenCost() };
  }

  const tweetUrl = `https://x.com/i/status/${tweetId}`;
  const prompt = `Look at the replies and quote tweets to this tweet. Pick 5-10 representative comments (including the top comments). Give each reply's author name, full text and engagement. Please respond with only the list of comments and no other text besides that.

Tweet URL: ${tweetUrl}
Tweet text: "${tweetText}"`;

  const { text, usage, steps } = await generateText({
    model: xai.responses(GROK_MODEL) as any,
    prompt,
    tools: {
      x_search: xai.tools.xSearch() as any,
    },
  });

  const searchCalls = steps?.reduce(
    (n, s) => n + (s.toolCalls?.filter((tc) => tc.toolName === "x_search").length ?? 0),
    0,
  ) ?? 0;
  const cost = calculateGrokCost(
    usage?.inputTokens ?? 0,
    usage?.outputTokens ?? 0,
    searchCalls,
  );

  log?.set("agent.comments", { text, cost });

  return { comments: text, cost };
}
