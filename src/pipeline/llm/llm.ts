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
      maxRetries: 2, // SDK built-in retries for 429, 500, 502, 503
    });
  }
  return _client;
}

function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  // OpenRouter wraps provider failures as 400 "Provider returned error"
  if (status === 400 && String(err?.message ?? "").includes("Provider returned error")) return true;
  // Standard retryable codes (in case SDK retries are exhausted)
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  // Network errors
  if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENETUNREACH") return true;
  // Fallbacks for SDK shapes that hide status in the message body / generic timeouts
  const msg: string = err?.message ?? "";
  if (/"code"\s*:\s*(429|500|502|503|504)/.test(msg)) return true;
  if (/operation timed out|timeout/i.test(msg)) return true;
  return false;
}

/** Extract useful details from an OpenRouter error for logging.
 * The OpenAI SDK throws APIError with .error (parsed JSON body), .status, .headers.
 * OpenRouter 400s include { error: { code, message }, metadata: { provider_name, raw } }
 */
function formatErrorDetail(err: any): string {
  const status = err?.status ?? err?.response?.status ?? "?";
  const message = String(err?.message ?? "unknown");
  // Dump the full error body from OpenRouter (the most useful diagnostic)
  const errorBody = err?.error;
  let bodyStr = "";
  if (errorBody && typeof errorBody === "object") {
    try {
      bodyStr = ` | body: ${JSON.stringify(errorBody).slice(0, 500)}`;
    } catch { /* ignore stringify failures */ }
  }
  return `${status} ${message}${bodyStr}`;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** A 200 OK with empty content is a silent provider failure — OpenRouter
 * sometimes returns no message body when an upstream provider misbehaves.
 * Treat as retryable so every caller (query writer, judge, pipeline) gets
 * the fix automatically. Tool-call responses are NOT empty (they have
 * tool_calls), so this won't false-trigger on those. */
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
 * Wrap an LLM create call with retry + exponential backoff.
 * Retries on OpenRouter "400 Provider returned error", 429, 502, 503, network
 * errors, and on a 200 OK that comes back with empty content (silent provider
 * failure).
 */
async function callWithRetry(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await getClient().chat.completions.create(params);
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
      // Enrich the error message with full details before re-throwing
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

// Backwards-compatible: existing code uses `llm.create(...)` directly.
// The proxy intercepts `create` calls and wraps them with retry logic,
// so all 17 existing call sites get automatic retry for free.
export const llm = new Proxy({} as OpenAI.Chat.Completions, {
  get(_target, prop) {
    if (prop === "create") {
      return callWithRetry;
    }
    return (getLlm() as any)[prop];
  },
});
