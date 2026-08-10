/**
 * Tweet Comments
 *
 * Asks Grok for a handful of representative replies under a tweet.
 */

import { generateText } from "ai";
import { xai } from "../llm/xai";
import { getTweetLog } from "../utils/tweetLog";
import { GROK_MODEL, calculateGrokCost } from "../cost-tracking/pricing";
import { trackLlmCall } from "../cost-tracking/costTracker";

export async function fetchTweetComments(
  tweetId: string,
  tweetText: string,
): Promise<string> {
  const log = getTweetLog();

  if (!process.env.XAI_API_KEY) {
    return "";
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

  trackLlmCall({
    name: "inputs.comments",
    input_tokens: cost.input_tokens,
    output_tokens: cost.output_tokens,
    cost: cost.cost,
    tools: searchCalls > 0 ? [{ name: "x_search", input_tokens: 0, output_tokens: 0, cost: searchCalls * 0.005 }] : [],
  });

  log?.set("inputs.comments", { text });

  return text;
}
