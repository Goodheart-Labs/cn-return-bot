/**
 * cheap-bot — Stage 1: Query writer
 *
 * One DeepSeek call that emits 1-3 search queries from the tweet context.
 * No iteration, no follow-up — single shot. This is the most hill-climbable
 * surface in cheap-bot; the later "query-writing teacher" idea targets this
 * stage with a separate sub-task dataset.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { STEP } from "../utils/noteWriterSteps";
import { runJsonLlmCall } from "../utils/jsonLlmCall";

export interface QueryWriterResult {
  queries: string[];
}

const SYSTEM_PROMPT = `You write Google search queries that find evidence about claims in a social-media post on X/Twitter.

Your job: read the post, identify each distinct factual claim it makes, and produce 2-5 search queries that together would surface authoritative sources for ALL of them.

## Step 1: decompose

A tweet usually combines an EVENT-level claim ("X happened on date Y in place Z") with one or more FRAMING claims about who is involved, why, or what it means ("Islamists attacked", "Dem area", "RINO", "the suspect is Indian", "X turned on Y"). Identify both.

## Step 2: write one query per claim

- **Event query**: the people, places, dates, organizations, or numbers named in the post, plus the action (e.g. "Charlie Kirk shot Utah Valley University 2025").
- **Framing/identity queries**: when the post uses a character or identity label ("Islamist", "antifa", "RINO", "Dem", "Indian", "fascist"), write a separate query directly checking that label against the named suspect / location / person — \`<suspect name> voter registration party affiliation\`, or a background check like "Nadeam Nahas Cohasset Massachusetts background ethnicity".
- **Primary-source query** for tweets citing a named survey / agency / poll: query the source directly ("Gallup household chores 2019", "BLS unemployment rate Illinois 2024") to get ground-truth numbers.

## What makes a good query
- Include the specific people, places, dates, organizations, events, or numbers named in the post.
- Use exact quoted phrases for distinctive wording (e.g. \`"sealed the document"\`).
- Combine entity name + topic, not just one or the other.
- Prefer phrasings a journalist or fact-checker would use.
- For framing/identity queries specifically, a fact-check brand suffix often helps ("fact check", "snopes", "leadstories", "voter registration", "party affiliation").

## What to avoid
- Vague queries like "is this true", "fact check claim", "did this happen".
- Queries that just repeat the whole tweet text.
- Queries that presuppose the answer (hindsight bias).
- **Multiple separate quoted phrases in one query** (e.g. \`"phrase A" "phrase B" "phrase C"\` — empirically this triggers junk results from the search engine).
- A fact-check brand suffix on the event-level query — it adds noise; reserve it for the framing/identity query.

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
          description: "2-5 Google search queries (one per distinct claim), or [] for opinion/joke posts.",
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

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: userMessage },
  ];
  log?.set(`${STEP.queryWriter}.messages.0`, { systemPrompt: SYSTEM_PROMPT, userMessage, model });

  const parsed = await runJsonLlmCall<{ queries: string[] }>({
    costName: "cheapBot.queryWriter",
    model,
    messages,
    responseFormat: RESPONSE_FORMAT,
    schemaHint: `{ "queries": string[] }`,
  });
  log?.set(`${STEP.queryWriter}.messages.1`, { content: parsed });

  return { queries: parsed.queries ?? [] };
}
