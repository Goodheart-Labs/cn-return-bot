/**
 * Tweet Comments
 *
 * Asks Grok for a handful of representative replies under a tweet.
 */

import { generateText } from "ai";
import { grokCallCost, xai } from "../llm/xai";
import { getTweetLog } from "../utils/tweetLog";
import { GROK_MODEL } from "../cost-tracking/pricing";
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

  const result = await generateText({
    model: xai.responses(GROK_MODEL) as any,
    prompt,
    tools: {
      x_search: xai.tools.xSearch() as any,
    },
  });
  const { text } = result;
  trackLlmCall({ name: "inputs.comments", ...grokCallCost(result, GROK_MODEL), tools: [] });

  log?.set("inputs.comments", { text });

  return text;
}
