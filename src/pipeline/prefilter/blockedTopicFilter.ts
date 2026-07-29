/**
 * Blocked-topic filter — a single deepseek-v4-flash call (reasoning, no tools,
 * no search) that checks whether a post is on one of the BLOCKED_TOPICS we
 * never write notes on. Runs before everything else — even the note-needed
 * prefilter — so a blocked post costs one cheap LLM call and nothing more.
 */
import type { Post } from "../../api/fetchEligiblePosts";
import { getOriginalTweetContent } from "../../utils/retweetUtils";
import { withBotConfig, type BotConfig } from "../ab-testing/botConfig";
import {
  TOPIC_FILTER_SYSTEM_PROMPT,
  TOPIC_FILTER_RESPONSE_FORMAT,
  buildTopicFilterUserMessage,
} from "../prompts/prefilter/blockedTopics";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { getTweetLog } from "../utils/tweetLog";

const DEEPSEEK = "deepseek/deepseek-v4-flash";
const STEP = "topic_filter";

/** Self-contained config for the filter's one call — deepseek-v4-flash,
 *  reasoning high + temp 0 (matches the note-needed prefilter's deterministic
 *  settings). Entered with withBotConfig so the picked bot's config is
 *  untouched; web_search/video fields are required by the type but unused. */
const TOPIC_FILTER_CONFIG: BotConfig = {
  botId: "blocked-topic-filter",
  model: DEEPSEEK,
  web_search: "searxng",
  video_description_strategy: "frames",
  parallel_research: false,
  reasoning_effort: "high",
  temperature: 0,
};

export interface TopicFilterVerdict {
  blocked: boolean;
  reasoning: string;
}

/** Decide whether `post` is on a blocked topic. Logs its messages + verdict
 *  under `topic_filter.*` on the ambient tweet log; the call's cost lands in
 *  the ambient cost tracker under the `topic_filter` group. */
export async function runBlockedTopicFilter(post: Post): Promise<TopicFilterVerdict> {
  const content = getOriginalTweetContent(post);
  const userMessage = buildTopicFilterUserMessage(post.author_name ?? "unknown", content.text);

  const log = getTweetLog();
  log?.set(`${STEP}.messages.0`, { systemPrompt: TOPIC_FILTER_SYSTEM_PROMPT, userMessage, model: DEEPSEEK });

  const parsed = await withBotConfig(TOPIC_FILTER_CONFIG, () =>
    runJsonLlmCall<{ reasoning: string; blocked: boolean }>({
      costName: STEP,
      model: DEEPSEEK,
      messages: [
        { role: "system", content: TOPIC_FILTER_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      responseFormat: TOPIC_FILTER_RESPONSE_FORMAT,
      schemaHint: `{ "reasoning": string, "blocked": boolean }`,
    }),
  );

  log?.set(`${STEP}.messages.1`, { content: parsed });
  const verdict = { blocked: !!parsed.blocked, reasoning: parsed.reasoning ?? "" };
  log?.set(`${STEP}.verdict`, verdict);
  return verdict;
}
