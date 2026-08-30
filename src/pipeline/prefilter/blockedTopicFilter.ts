/**
 * The blocked-topic filter checks whether a post is about one of the
 * BLOCKED_TOPICS we never write notes on. It is a single deepseek-v4-flash call
 * with reasoning turned on, no tools and no search.
 * It only runs when `config.topic_filter` is on, which is the TOPIC_FILTER_TEST
 * arm. It runs before every other step, including the note-needed prefilter.
 * It receives the shared bot-input user message that processSingleTweet builds
 * once. The note-needed prefilter and the bot's search step read the same
 * message.
 */
import { withBotConfig, type BotConfig } from "../ab-testing/botConfig";
import {
  TOPIC_FILTER_SYSTEM_PROMPT,
  TOPIC_FILTER_RESPONSE_FORMAT,
} from "../prompts/prefilter/blockedTopics";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { getTweetLog } from "../utils/tweetLog";

const DEEPSEEK = "deepseek/deepseek-v4-flash";
const STEP = "topic_filter";

/** The config for the filter's one LLM call. It runs deepseek-v4-flash with
 *  reasoning effort high and temperature 0, the same deterministic settings the
 *  note-needed prefilter uses. The web_search and video_description_strategy
 *  fields are required by the type, but this filter never uses them. */
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

/** Decides whether the post in `userMessage` is about a blocked topic. It logs
 *  its messages and its verdict under `topic_filter.*` on the ambient tweet log.
 *  The cost of the call lands in the ambient cost tracker under the
 *  `topic_filter` group. */
export async function runBlockedTopicFilter(userMessage: string): Promise<TopicFilterVerdict> {
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
