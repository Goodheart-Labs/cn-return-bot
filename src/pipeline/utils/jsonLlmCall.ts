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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function runJsonLlmCall<T>(params: {
  /** Cost-tracker / llm_inputs key. The first attempt keeps it verbatim so
   *  existing log lookups still hit; retries append `.retry.N`. */
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
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const callName = attempt === 1 ? params.costName : `${params.costName}.retry.${attempt - 1}`;
    const { response, costEntry } = await trackedLlmCreate(callName, {
      model: params.model,
      messages: params.messages,
      response_format: params.responseFormat,
      ...llmTuningParams(config),
    } as any);
    trackLlmCall(costEntry);

    const content = response.choices?.[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(stripJsonFences(content)) as T;
    } catch {
      if (attempt >= maxAttempts) {
        throw new ModelOutputInvalidError(
          `${params.costName}: model output was not valid JSON after ${maxAttempts} attempts. content="${truncateUrlsForLog(content)}"`,
        );
      }
      params.messages.push({ role: "assistant", content });
      params.messages.push({
        role: "user",
        content: `Your previous response was not valid JSON. Respond with ONLY a JSON object matching: ${params.schemaHint}. No prose, no markdown fences.`,
      });
    }
  }
  throw new Error("unreachable");
}
