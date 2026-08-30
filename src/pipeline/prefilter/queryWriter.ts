/**
 * Prefilter step: query writer
 *
 * A single call that emits one to three search queries from the tweet context.
 * It does not iterate and it never follows up.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, COST } from "../utils/noteWriterSteps";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { QUERY_WRITER_SYSTEM_PROMPT, QUERY_WRITER_RESPONSE_FORMAT } from "../prompts/prefilter/queryWriter";

export interface QueryWriterResult {
  queries: string[];
}

export async function runQueryWriter(userMessage: string): Promise<QueryWriterResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.search_model ?? config.model;

  const messages = [
    { role: "system" as const, content: QUERY_WRITER_SYSTEM_PROMPT },
    { role: "user" as const, content: userMessage },
  ];
  log?.set(`${STEP.queryWriter}.messages.0`, { systemPrompt: QUERY_WRITER_SYSTEM_PROMPT, userMessage, model });

  const parsed = await runJsonLlmCall<{ queries: string[] }>({
    costName: COST.queryWriter,
    model,
    messages,
    responseFormat: QUERY_WRITER_RESPONSE_FORMAT,
    schemaHint: `{ "queries": string[] }`,
  });
  log?.set(`${STEP.queryWriter}.messages.1`, { content: parsed });

  return { queries: parsed.queries ?? [] };
}
