/**
 * The shared JSON LLM call for the prefilter steps and for the simple-bot
 * stages that reuse it. It wraps `trackedLlmCreate` and adds the tolerance for
 * provider quirks that every JSON stage needs. It strips ```json fences and then
 * parses the output. Some providers enforce the schema loosely and answer in
 * prose or markdown even though a json_schema response_format was set. DeepSeek
 * v4 Flash does this now and then. When it happens we ask the model again for
 * JSON instead of crashing the row.
 *
 * The `require_parameters` option in llm.ts makes this rarer but does not remove
 * it. It only guarantees that the provider accepts a response_format. It does not
 * guarantee that the provider constrains its decoding to the schema. So every
 * JSON stage still needs this fallback.
 */

import { getBotConfig, llmTuningParams } from "../ab-testing/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../cost-tracking/costTracker";
import { ModelOutputInvalidError } from "./errors";
import { stripJsonFences, truncateUrlsForLog } from "./jsonOutput";

const DEFAULT_MAX_ATTEMPTS = 3;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * The corrective retry loop that every JSON LLM stage shares. Both the search
 * paths that prompt for JSON and `runJsonLlmCall` use it. It runs `call`, parses
 * the output, and on a parse or shape failure asks the model again for clean
 * JSON. The re-ask echoes the model's own bad reply back to it. After
 * `maxAttempts` tries it gives up and throws `ModelOutputInvalidError`.
 * Everything that depends on the provider stays in the caller's `call`. That
 * covers how the request is made, how the raw text is pulled out of the reply,
 * and how the cost is tracked. Only the retry mechanics live here.
 */
export async function parseJsonWithRetry<T>(params: {
  /** Label used only in the thrown error message. */
  source: string;
  /** On every failure the model's reply and a corrective prompt are appended to
   *  this array. */
  messages: any[];
  /** The shape echoed back to the model in the re-ask. An example is
   *  `{ "queries": string[] }`. */
  schemaHint: string;
  maxAttempts?: number;
  /** Makes one LLM call with the current messages. It returns the text to parse
   *  and the raw assistant reply to echo back on a retry. The two differ when the
   *  caller has to dig the JSON out of a reasoning preamble. */
  call: (messages: any[], attempt: number) => Promise<{ toParse: string; assistantEcho: string }>;
  /** Parses and validates the text. It throws when the output is invalid or has
   *  the wrong shape. */
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
  /** The name the cost tracker records. The first attempt uses it unchanged so
   *  that existing cost lookups still find it. Every retry appends `.retry.N`. */
  costName: string;
  model: string;
  /** On every parse failure the model's reply and a corrective prompt are
   *  appended to this array. A caller can add its own content validation on top
   *  by appending to the same array and calling again. The writer's length retry
   *  works that way. */
  messages: ChatMessage[];
  responseFormat: object;
  /** The shape echoed back to the model in the re-ask. An example is
   *  `{ "queries": string[] }`. */
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
