/**
 * Prompt — blocked-topic filter.
 *
 * See runBlockedTopicFilter in src/pipeline/prefilter/blockedTopicFilter.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

/** Topics we never write notes on. Add new entries here. */
export const BLOCKED_TOPICS = [
  "the assassination of Charlie Kirk",
  "Tyler Robinson",
  "Candace Owens (posts about her or authored by her)",
  "the health or death of Mitch McConnell",
];

export const TOPIC_FILTER_SYSTEM_PROMPT = `You decide whether an X post is about any of these topics:

${BLOCKED_TOPICS.map((topic) => `- ${topic}`).join("\n")}

Return JSON with two fields:
- reasoning: one sentence, written BEFORE the verdict.
- blocked: boolean. True if the post is about (or authored by) any listed topic.`;

export const TOPIC_FILTER_RESPONSE_FORMAT = jsonSchemaResponseFormat("blocked_topic_filter", {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    blocked: { type: "boolean" },
  },
  required: ["reasoning", "blocked"],
  additionalProperties: false,
});
