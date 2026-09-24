import { createXai } from "@ai-sdk/xai";
import { generateText } from "ai";
import { calculateGrokCost, type TokenCost } from "../cost-tracking/pricing";
import { addWarning } from "../utils/warnings";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

if (!process.env.XAI_API_KEY) {
  console.warn("XAI_API_KEY not set - Grok X search will not be available");
}

export const xai = createXai({
  apiKey: process.env.XAI_API_KEY,
});

/** One xAI "tick" is a ten-billionth of a dollar (docs.x.ai/developers/cost-tracking). */
const USD_PER_XAI_TICK = 1e-10;

/** The parts of a Vercel AI SDK generateText result that the cost needs. */
interface GrokResult {
  usage?: { inputTokens?: number; outputTokens?: number };
  steps?: Array<{ toolCalls?: Array<{ toolName: string }>; response?: { body?: unknown } }>;
}

export function countXSearchCalls(result: GrokResult): number {
  return result.steps?.reduce((n, s) => n + (s.toolCalls?.filter((tc) => tc.toolName === "x_search").length ?? 0), 0) ?? 0;
}

/** What a Grok call cost. xAI puts the amount it billed into the usage block of
 *  every raw response, after cache discounts and including the X search fees.
 *  Since 2026-09-21 those fees depend on how many posts a search returned, which
 *  our rate table cannot know, so the billed amount is the one to record.
 *  When a step lacks it we fall back to the rate table and add a warning, so an
 *  estimated cost is visible on the run. */
export function grokCallCost(result: GrokResult, model: string): TokenCost {
  const inputTokens = result.usage?.inputTokens ?? 0;
  const outputTokens = result.usage?.outputTokens ?? 0;
  const billedTicks = (result.steps ?? []).map((s) => (s.response?.body as any)?.usage?.cost_in_usd_ticks);
  if (billedTicks.length > 0 && billedTicks.every((t) => typeof t === "number")) {
    const ticks = billedTicks.reduce((sum: number, t: number) => sum + t, 0);
    return { input_tokens: inputTokens, output_tokens: outputTokens, cost: ticks * USD_PER_XAI_TICK };
  }
  addWarning(`xAI reported no billed cost for ${model}, so the recorded cost is an estimate from the rate table`);
  return calculateGrokCost(inputTokens, outputTokens, countXSearchCalls(result), model);
}

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

  const searchCalls = countXSearchCalls(result);
  const cost = grokCallCost(result, p.model);

  return { text, parsed, searchCalls, cost };
}
