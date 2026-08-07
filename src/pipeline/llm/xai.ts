import { createXai } from "@ai-sdk/xai";
import { generateText } from "ai";
import { calculateGrokCost, type TokenCost } from "../cost-tracking/pricing";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

if (!process.env.XAI_API_KEY) {
  console.warn("XAI_API_KEY not set - Grok X search will not be available");
}

export const xai = createXai({
  apiKey: process.env.XAI_API_KEY,
});

function isRetryableError(err: any): boolean {
  // The Vercel AI SDK reports an APICallError with a statusCode field, and a
  // network failure with a code field.
  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENETUNREACH") return true;
  const msg: string = err?.message ?? "";
  if (/"code"\s*:\s*(429|500|502|503|504)/.test(msg)) return true;
  if (/UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED/.test(msg)) return true;
  if (/operation timed out|timeout/i.test(msg)) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Single-call native helper for simple-bot search ---

export interface XaiNativeParams {
  /** xAI model id (e.g. "grok-4.3", "grok-4-fast"). */
  model: string;
  systemPrompt?: string;
  userMessage: string;
  enableXSearch?: boolean;
  /**
   * The JSON shape the model is asked to produce. The Vercel AI SDK does not
   * combine structured output with tool use cleanly. So we describe the schema in
   * the prompt and parse the answer ourselves. Grok 4 reliably returns parseable
   * JSON when asked this way.
   */
  responseSchema?: object;
}

export interface XaiNativeResult {
  text: string;
  parsed?: any;
  searchCalls: number;
  cost: TokenCost;
}

export async function xaiNativeGenerate(p: XaiNativeParams): Promise<XaiNativeResult> {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY environment variable is required but not set");
  }

  const tools: Record<string, unknown> = {};
  if (p.enableXSearch) {
    tools.x_search = xai.tools.xSearch({ enableImageUnderstanding: true });
  }

  const promptParts: string[] = [];
  if (p.systemPrompt) promptParts.push(p.systemPrompt);
  promptParts.push(p.userMessage);
  if (p.responseSchema) {
    promptParts.push(
      `\nRespond with strict JSON only matching this schema:\n${JSON.stringify(p.responseSchema)}`,
    );
  }

  let result: any;
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      result = await generateText({
        model: xai.responses(p.model) as any,
        prompt: promptParts.join("\n\n"),
        tools: Object.keys(tools).length > 0 ? (tools as any) : undefined,
      });
      break;
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[xai] Retryable error (attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${p.model}): ${err?.statusCode ?? err?.status ?? err?.code} ${err?.message?.slice(0, 200)}. Retrying in ${backoff}ms...`,
        );
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  if (!result) throw lastError;

  const text = result.text ?? "";
  let parsed: any | undefined;
  if (p.responseSchema) {
    const cleaned = text.replace(/^```json\n?|\n?```$/g, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // The caller deals with a missing parsed value.
    }
  }

  const searchCalls: number = result.steps?.reduce(
    (n: number, s: any) => n + (s.toolCalls?.filter((tc: any) => tc.toolName === "x_search").length ?? 0),
    0,
  ) ?? 0;

  const cost = calculateGrokCost(
    result.usage?.inputTokens ?? 0,
    result.usage?.outputTokens ?? 0,
    searchCalls,
    p.model,
  );

  return { text, parsed, searchCalls, cost };
}
