import OpenAI from "openai";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

let _client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!_client) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error(
        "OPENROUTER_API_KEY environment variable is required but not set"
      );
    }
    _client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      maxRetries: 2, // The SDK retries 429, 500, 502 and 503 on its own.
    });
  }
  return _client;
}

function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  // OpenRouter reports a failure of the upstream provider as a 400 whose message
  // reads "Provider returned error".
  if (status === 400 && String(err?.message ?? "").includes("Provider returned error")) return true;
  // The usual retryable status codes. We still check them in case the SDK has used
  // up its own retries.
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENETUNREACH") return true;
  // Some SDK error shapes hide the status inside the message body. The second test
  // also catches a generic timeout message that carries no status at all.
  const msg: string = err?.message ?? "";
  if (/"code"\s*:\s*(429|500|502|503|504)/.test(msg)) return true;
  if (/operation timed out|timeout/i.test(msg)) return true;
  return false;
}

/** Pulls the useful details out of an OpenRouter error so we can log them.
 * The OpenAI SDK throws an APIError that carries the parsed JSON body on .error,
 * plus .status and .headers. The body of an OpenRouter 400 looks like
 * { error: { code, message }, metadata: { provider_name, raw } }.
 */
function formatErrorDetail(err: any): string {
  const status = err?.status ?? err?.response?.status ?? "?";
  const message = String(err?.message ?? "unknown");
  // The full error body from OpenRouter is the most useful diagnostic we get, so
  // include it.
  const errorBody = err?.error;
  let bodyStr = "";
  if (errorBody && typeof errorBody === "object") {
    try {
      bodyStr = ` | body: ${JSON.stringify(errorBody).slice(0, 500)}`;
    } catch { /* A body we cannot stringify is simply left out. */ }
  }
  return `${status} ${message}${bodyStr}`;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** A 200 OK with empty content is a silent provider failure. OpenRouter sometimes
 * returns no message body when an upstream provider misbehaves. We treat it as
 * retryable here, so every caller gets the retry without asking for it.
 * A tool-call response is never empty, because it carries tool_calls. So this
 * check does not fire on those. */
function hasEmptyContent(result: OpenAI.Chat.Completions.ChatCompletion): boolean {
  const choice = result.choices?.[0];
  if (!choice) return true;
  const msg = choice.message;
  const hasToolCalls = Array.isArray((msg as any)?.tool_calls) && (msg as any).tool_calls.length > 0;
  if (hasToolCalls) return false;
  const content = msg?.content ?? "";
  return typeof content === "string" && content.trim().length === 0;
}

/**
 * Wraps an LLM create call with retries and exponential backoff.
 * It retries the OpenRouter "400 Provider returned error", the 429, 500, 502, 503
 * and 504 statuses, network errors, and a 200 OK that comes back with empty
 * content.
 */
async function callWithRetry(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  // Tell OpenRouter to route only to providers that honour every parameter we
  // send. The ones that matter are response_format=json_schema and tools. Without
  // this, OpenRouter can pick a provider that quietly ignores the strict schema.
  // The model then wraps its JSON in ```json fences and we cannot parse it.
  const routedParams = {
    ...params,
    provider: { require_parameters: true, ...(params as any).provider },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await getClient().chat.completions.create(routedParams);
      if (hasEmptyContent(result) && attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[llm] Empty content (attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${params.model}). Retrying in ${backoff}ms...`
        );
        await sleep(backoff);
        continue;
      }
      return result;
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[llm] Retryable error (attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${params.model}): ${formatErrorDetail(err)}. Retrying in ${backoff}ms...`
        );
        await sleep(backoff);
        continue;
      }
      if (err instanceof Error) {
        err.message = `[model: ${params.model}] ${formatErrorDetail(err)}`;
      }
      throw err;
    }
  }
  throw lastError;
}

export function extractCitations(
  result: OpenAI.Chat.Completions.ChatCompletion
): string[] {
  const annotations = result.choices?.[0]?.message?.annotations;
  if (!annotations) return [];
  return annotations
    .filter((a) => a.type === "url_citation")
    .map((a) => a.url_citation.url)
    .filter((url, i, arr) => arr.indexOf(url) === i);
}

function getLlm(): OpenAI.Chat.Completions {
  return getClient().chat.completions;
}

// Call sites use `llm.create(...)` as if this were the OpenAI client itself. The
// proxy intercepts `create` and routes it through the retry wrapper, so every call
// site gets retries without any change. Every other property falls through to the
// real client.
export const llm = new Proxy({} as OpenAI.Chat.Completions, {
  get(_target, prop) {
    if (prop === "create") {
      return callWithRetry;
    }
    return (getLlm() as any)[prop];
  },
});
