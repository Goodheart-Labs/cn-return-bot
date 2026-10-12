/**
 * The bot's own model call: Muse writes the reply that explains why a post
 * needs no note. The research and the note itself reuse the production search
 * and writer prompts on the claim-check service, and the tagger's comment
 * reaches them as the note request (see userMessage.ts).
 */

import { DEFAULT_CONFIG, withBotConfig } from "../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../pipeline/cost-tracking/costTracker";
import { runJsonLlmCall } from "../pipeline/utils/jsonLlmCall";

const MUSE = "meta/muse-spark-1.3-contributor";

export const NO_NOTE_REPLY_SYSTEM_PROMPT = `You write the reply a Community Notes bot posts on X when it decided a post needs no note. A reader tagged the bot under the post and asked about it. You get the post, the reader's request and the bot's research findings.

Write at most three plain sentences that tell the reader why no note is needed. Name the specific fact that settles it. You may cite one URL from the findings, at the very end. Write so that someone who dislikes the post would still find the answer fair. No markdown, no hashtags, no emoji.

Return JSON: {"reply": string}`;

export const NO_NOTE_REPLY_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "tag_bot_no_note_reply",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { reply: { type: "string" } },
      required: ["reply"],
    },
  },
};

export function buildNoNoteReplyUserMessage(params: { postContext: string; findings: string }): string {
  return `${params.postContext}\n\n## Research findings\n\n${params.findings}`;
}

/** runJsonLlmCall reads the bot config and records costs, so the call runs
 *  inside both. */
export async function writeNoNoteReply(postContext: string, findings: string): Promise<string> {
  const { reply } = await withBotConfig({ ...DEFAULT_CONFIG, botId: "x-tag" }, () => withCostTracker(() =>
    runJsonLlmCall<{ reply: string }>({
      costName: "x_tag.no_note_reply",
      model: MUSE,
      messages: [
        { role: "system", content: NO_NOTE_REPLY_SYSTEM_PROMPT },
        { role: "user", content: buildNoNoteReplyUserMessage({ postContext, findings }) },
      ],
      responseFormat: NO_NOTE_REPLY_RESPONSE_FORMAT,
      schemaHint: '{"reply":string}',
    })));
  return reply;
}
