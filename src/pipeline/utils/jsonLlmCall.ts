/**
 * Shared JSON LLM call for the cheap-bot pipeline (and the simple-bot stages it
 * reuses). Wraps trackedLlmCreate with the provider-quirk tolerance every JSON
 * stage needs: strip ```json fences, parse, and — because loosely-enforcing
 * providers (DeepSeek v4 Flash) occasionally answer in prose/markdown despite a
 * json_schema response_format — re-ask for JSON rather than crashing the row.
 *
 * `require_parameters` (llm.ts) reduces but does not eliminate this: it only
 * guarantees the provider accepts response_format, not that it constrains
 * decoding to the schema. So every JSON stage needs this fallback.
 */

import { getBotConfig, llmTuningParams } from "../ab-testing/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../cost-tracking/costTracker";
import { ModelOutputInvalidError } from "./errors";
import { stripJsonFences, truncateUrlsForLog } from "./jsonOutput";

const DEFAULT_MAX_ATTEMPTS = 3;

/** OpenAI/OpenRouter multimodal content parts. A message's content is either a
 *  plain string or an array of these (text + images) for vision models. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/**
 * Corrective-retry loop shared by every JSON LLM stage — the prompted-JSON
 * search paths and `runJsonLlmCall` alike. Repeatedly runs `call`, parses its
 * output, and on a parse/shape failure re-asks the model for clean JSON (echoing
 * its own bad reply back) up to `maxAttempts` times before throwing
 * `ModelOutputInvalidError`. The provider-specific bits — how the request is
 * made, how the raw text is extracted, cost tracking — live in the caller's
 * `call`; only the retry mechanics live here.
 */
export async function parseJsonWithRetry<T>(params: {
  /** Label used only in the thrown error message. */
  source: string;
  /** Mutated with the model's reply + a corrective prompt on each failure. */
  messages: any[];
  /** Shape echoed back in the re-ask, e.g. `{ "queries": string[] }`. */
  schemaHint: string;
  maxAttempts?: number;
  /** One LLM call with the current messages. Returns the text to parse plus the
   *  raw assistant reply to echo back on retry (they differ when the caller
   *  extracts JSON out of a reasoning preamble). */
  call: (messages: any[], attempt: number) => Promise<{ toParse: string; assistantEcho: string }>;
  /** Parse + validate; throw on invalid or mis-shaped output. */
  parse: (toParse: string) => T;
}): Promise<T> {
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { toParse, assistantEcho } = await params.call(params.messages, attempt);
    try {
      return params.parse(toParse);
    } catch {
      if (attempt >= maxAttempts) {
        throw new ModelOutputInvalidError(
          `${params.source}: model output was not valid JSON after ${maxAttempts} attempts. content="${truncateUrlsForLog(assistantEcho)}"`,
        );
      }
      params.messages.push({ role: "assistant", content: assistantEcho });
      params.messages.push({
        role: "user",
        content: `Your previous response was not valid JSON. Respond with ONLY a JSON object matching: ${params.schemaHint}. No prose, no markdown fences.`,
      });
    }
  }
  throw new Error("unreachable");
}

export async function runJsonLlmCall<T>(params: {
  /** Cost-tracker name. The first attempt keeps it verbatim so existing cost
   *  lookups still hit; retries append `.retry.N`. */
  costName: string;
  model: string;
  /** Mutated with the model's reply + a corrective prompt on each parse failure,
   *  so a caller can layer its own content validation (e.g. the writer's length
   *  retry) by appending to the same array and calling again. */
  messages: ChatMessage[];
  responseFormat: object;
  /** Shape echoed back in the re-ask, e.g. `{ "queries": string[] }`. */
  schemaHint: string;
  maxAttempts?: number;
}): Promise<T> {
  const config = getBotConfig();
  return parseJsonWithRetry<T>({
    source: params.costName,
    messages: params.messages,
    schemaHint: params.schemaHint,
    maxAttempts: params.maxAttempts,
    call: async (messages, attempt) => {
      const callName = attempt === 1 ? params.costName : `${params.costName}.retry.${attempt - 1}`;
      const { response, costEntry } = await trackedLlmCreate(callName, {
        model: params.model,
        messages,
        response_format: params.responseFormat,
        ...llmTuningParams(config),
      } as any);
      trackLlmCall(costEntry);
      const content = response.choices?.[0]?.message?.content ?? "{}";
      return { toParse: stripJsonFences(content), assistantEcho: content };
    },
    parse: (toParse) => JSON.parse(toParse) as T,
  });
}
