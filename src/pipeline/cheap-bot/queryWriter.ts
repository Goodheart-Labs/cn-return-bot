/**
 * cheap-bot — Stage 1: Query writer
 *
 * One DeepSeek call that emits 1-3 search queries from the tweet context.
 * No iteration, no follow-up — single shot. This is the most hill-climbable
 * surface in cheap-bot; the later "query-writing teacher" idea targets this
 * stage with a separate sub-task dataset.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { ModelOutputInvalidError } from "../utils/errors";

export interface QueryWriterResult {
  queries: string[];
}

const SYSTEM_PROMPT = `You write Google search queries that find evidence about claims in a social-media post on X/Twitter.

Your job: read the post and produce 1-3 search queries that, run on Google, would surface authoritative sources confirming or refuting the post's factual claims.

## What makes a good query
- Include the specific people, places, dates, organizations, events, or numbers named in the post.
- Use exact quoted phrases for distinctive wording (e.g. \`"sealed the document"\`).
- Combine entity name + topic, not just one or the other.
- Prefer query phrasings that journalists or fact-checkers would actually use.

## What to avoid
- Vague queries like "is this true", "fact check claim", "did this happen".
- Queries that just repeat the whole tweet text.
- Queries that presuppose the answer (hindsight bias).

If the post is pure opinion / joke / satire with no checkable factual claim, return an empty queries list.

Return JSON only: {"queries": ["...", "..."]}`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "cheap_bot_queries",
    strict: true,
    schema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description: "1-3 Google search queries, or [] for opinion/joke posts.",
        },
      },
      required: ["queries"],
      additionalProperties: false,
    },
  },
};

export async function runQueryWriter(userMessage: string): Promise<QueryWriterResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.search_model ?? config.model;

  log?.set("cheapBot.queryWriter.messages.0", { systemPrompt: SYSTEM_PROMPT, userMessage, model });

  const { response, costEntry } = await trackedLlmCreate("cheapBot.queryWriter", {
    model,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ],
    response_format: RESPONSE_FORMAT,
  } as any);
  trackLlmCall(costEntry);

  const content = response.choices?.[0]?.message?.content ?? "";
  let parsed: { queries: string[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ModelOutputInvalidError(
      `cheapBot.queryWriter: model output was not valid JSON. content="${content.slice(0, 200)}"`,
    );
  }
  log?.set("cheapBot.queryWriter.messages.1", { content: parsed });

  return { queries: parsed.queries ?? [] };
}
