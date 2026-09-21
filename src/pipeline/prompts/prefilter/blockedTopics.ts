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
  // The notes are written by these companies' own models, so a note on their
  // conduct would be a company grading itself. This entry is about the
  // companies, not about AI: a post that uses or shows AI-generated media, or
  // makes a general claim about what AI can do, is not about them.
  "the conduct, business, leadership, lobbying, regulation, safety or security claims, or controversies of the AI companies Anthropic, OpenAI, Google DeepMind, Meta AI or xAI",
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
