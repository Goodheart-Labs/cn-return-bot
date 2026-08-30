/**
 * Native Google Gen AI client.
 *
 * OpenRouter does not expose Gemini's googleSearch tool. The simple-bot search
 * variants that target Gemini therefore call this client directly. Media analysis
 * also goes through here so that it shares the key routing described below.
 *
 * `geminiNativeGenerate` tries GEMINI_API_KEY_FREE first. That key is the AI
 * Studio free tier. It only falls back to the paid GEMINI_API_KEY when the free
 * key is out of quota, which arrives as a 429 or a RESOURCE_EXHAUSTED message.
 * A transient server or network error is retried on the same key with backoff, so
 * it never uses up the fallback. The free tier is not billed, so free-tier calls
 * report a cost of zero while still keeping their token counts.
 *
 * `geminiNativeGenerateFree` tries the free key only and fails immediately when
 * the quota is gone. The trackedLlmCreate adapter uses it. That adapter sends
 * every Gemini call that needs no tools through the free key, and on failure falls
 * back to OpenRouter rather than to the paid native key.
 */

import { GoogleGenAI } from "@google/genai";
import { calculateGeminiCost, type TokenCost } from "../cost-tracking/pricing";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

interface GeminiKey {
  apiKey: string;
  tier: "free" | "paid";
}

const _clients = new Map<string, GoogleGenAI>();

function getClient(apiKey: string): GoogleGenAI {
  let client = _clients.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    _clients.set(apiKey, client);
  }
  return client;
}

/** The keys to try, in order. The free tier comes first and the paid key is the
 *  fallback. */
function geminiKeys(): GeminiKey[] {
  const keys: GeminiKey[] = [];
  if (process.env.GEMINI_API_KEY_FREE) keys.push({ apiKey: process.env.GEMINI_API_KEY_FREE, tier: "free" });
  if (process.env.GEMINI_API_KEY) keys.push({ apiKey: process.env.GEMINI_API_KEY, tier: "paid" });
  if (keys.length === 0) {
    throw new Error("GEMINI_API_KEY (or GEMINI_API_KEY_FREE) environment variable is required but not set");
  }
  return keys;
}

/** Returns the free key, or null when GEMINI_API_KEY_FREE is unset. The
 *  trackedLlmCreate adapter uses this. It tries the free native key and then falls
 *  back to OpenRouter rather than to the paid native key, because the calls it
 *  routes need no native tooling. */
export function geminiFreeKey(): GeminiKey | null {
  return process.env.GEMINI_API_KEY_FREE
    ? { apiKey: process.env.GEMINI_API_KEY_FREE, tier: "free" }
    : null;
}

/** True when the error means the free tier is out of quota. That is the signal to
 *  fall back to the paid key. */
export function isQuotaError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 429) return true;
  const msg: string = err?.message ?? "";
  if (/"code"\s*:\s*429/.test(msg)) return true;
  if (/RESOURCE_EXHAUSTED/.test(msg)) return true;
  return false;
}

/** True when the error is transient and worth retrying on the same key. */
function isTransientError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENETUNREACH") return true;
  // The ApiError from @google/genai puts the HTTP status inside the JSON message
  // body instead of exposing it as a field. So we fall back to reading the text.
  const msg: string = err?.message ?? "";
  if (/"code"\s*:\s*(500|502|503|504)/.test(msg)) return true;
  if (/UNAVAILABLE|DEADLINE_EXCEEDED/.test(msg)) return true;
  if (/operation timed out|timeout/i.test(msg)) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One part of a multimodal user turn. It is either plain text or inline media
 *  bytes. */
export type GeminiContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/** One conversation turn. A system message is not a turn. It is passed separately
 *  as systemInstruction. "model" is Gemini's name for the assistant role. */
export interface GeminiTurn {
  role: "user" | "model";
  text: string;
}

export type GeminiThinkingLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

export interface GeminiNativeParams {
  /** Model id without provider prefix, e.g. "gemini-3-flash-preview". */
  model: string;
  systemInstruction?: string;
  /** Text-only user turn. Ignored when `userParts` or `userTurns` is set. */
  userMessage?: string;
  /** A multimodal user turn holding text plus inline image or video bytes. It takes
   *  precedence over `userMessage`. */
  userParts?: GeminiContentPart[];
  /** The text history as user and model turns. It takes precedence over both
   *  `userParts` and `userMessage`. */
  userTurns?: GeminiTurn[];
  enableGoogleSearch?: boolean;
  /** A JSON schema in Gemini's flavour. Its type names are uppercase, such as
   *  "OBJECT" and "STRING". */
  responseSchema?: object;
  /** When set, the request asks for JSON output through responseMimeType even
   *  though no schema is given. */
  jsonOutput?: boolean;
  temperature?: number;
  thinkingLevel?: GeminiThinkingLevel;
}

export interface GeminiNativeResult {
  /** The raw text body. It is already JSON when responseSchema is set. */
  text: string;
  parsed?: any;
  /** The web grounding citations googleSearch returned, when it was enabled. */
  groundingChunks: { uri?: string; title?: string }[];
  /** How many web search queries Gemini issued during the call. */
  searchCalls: number;
  cost: TokenCost;
  /** Which key tier served the request. Free-tier cost is reported as $0. */
  keyTier: "free" | "paid";
}

/** Runs generateContent on one key. A transient error is retried with backoff.
 *  On the last key a quota error is retried too. On any earlier key a quota error
 *  is thrown at once, so the caller can switch keys instead of waiting the limit
 *  out. */
async function generateOnce(
  key: GeminiKey,
  request: { model: string; contents: unknown; config: unknown },
  retryQuota: boolean,
): Promise<any> {
  const ai = getClient(key.apiKey);
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await ai.models.generateContent(request as any);
    } catch (err: any) {
      lastError = err;
      const retryable = isTransientError(err) || (retryQuota && isQuotaError(err));
      if (attempt < MAX_RETRIES && retryable) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[gemini] Retryable error (${key.tier} key, attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${request.model}): ${err?.status ?? err?.code} ${err?.message?.slice(0, 200)}. Retrying in ${backoff}ms...`,
        );
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function buildRequest(p: GeminiNativeParams): { model: string; contents: unknown; config: unknown } {
  const config: Record<string, unknown> = {};
  if (p.systemInstruction) config.systemInstruction = p.systemInstruction;
  if (p.enableGoogleSearch) config.tools = [{ googleSearch: {} }];
  if (p.responseSchema) {
    config.responseMimeType = "application/json";
    config.responseSchema = p.responseSchema;
  } else if (p.jsonOutput) {
    config.responseMimeType = "application/json";
  }
  if (p.temperature !== undefined) config.temperature = p.temperature;
  if (p.thinkingLevel) config.thinkingConfig = { thinkingLevel: p.thinkingLevel };

  const contents: unknown = p.userTurns
    ? p.userTurns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }))
    : (p.userParts ?? p.userMessage ?? "");
  return { model: p.model, contents, config };
}

/** Runs the request against the keys in order and moves on to the next key when
 *  one is out of quota. `retryQuotaOnLastKey` decides what the final key does with
 *  a quota error. geminiNativeGenerate passes true, so the paid key waits the
 *  limit out with backoff. The free-only adapter path passes false, so it fails
 *  fast and its caller falls back to OpenRouter. */
async function runKeys(
  request: { model: string; contents: unknown; config: unknown },
  keys: GeminiKey[],
  retryQuotaOnLastKey: boolean,
): Promise<{ response: any; keyTier: "free" | "paid" }> {
  let lastError: any;
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k]!;
    const isLastKey = k === keys.length - 1;
    try {
      const response = await generateOnce(key, request, isLastKey && retryQuotaOnLastKey);
      return { response, keyTier: key.tier };
    } catch (err: any) {
      lastError = err;
      if (!isLastKey && isQuotaError(err)) {
        console.warn(`[gemini] ${key.tier} key out of quota (model: ${request.model}); falling back to next key.`);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function buildResult(p: GeminiNativeParams, response: any, keyTier: "free" | "paid"): GeminiNativeResult {
  const text = response.text ?? "";
  let parsed: any | undefined;
  if (p.responseSchema || p.jsonOutput) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // We do not throw on unparseable JSON. The caller can still read the raw
      // text, and the cost of the call is still recorded.
    }
  }

  const grounding = response.candidates?.[0]?.groundingMetadata;
  const groundingChunks = (grounding?.groundingChunks ?? []).map((c: any) => ({
    uri: c.web?.uri,
    title: c.web?.title,
  }));
  const searchCalls = grounding?.webSearchQueries?.length ?? 0;

  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  const cost = calculateGeminiCost(p.model, inputTokens, outputTokens, searchCalls);
  // The AI Studio free tier is not billed. We keep the token counts so the call is
  // still visible, and set the charge to zero.
  if (keyTier === "free") cost.cost = 0;

  return { text, parsed, groundingChunks, searchCalls, cost, keyTier };
}

/** Tries the free key first and falls back to the paid key when the free quota is
 *  gone. */
export async function geminiNativeGenerate(p: GeminiNativeParams): Promise<GeminiNativeResult> {
  const { response, keyTier } = await runKeys(buildRequest(p), geminiKeys(), true);
  return buildResult(p, response, keyTier);
}

/** Uses the free key only. It throws on a quota error without any backoff, so the
 *  caller can fall back to OpenRouter immediately. It also throws when
 *  GEMINI_API_KEY_FREE is unset. */
export async function geminiNativeGenerateFree(p: GeminiNativeParams): Promise<GeminiNativeResult> {
  const free = geminiFreeKey();
  if (!free) throw new Error("GEMINI_API_KEY_FREE is required but not set");
  const { response, keyTier } = await runKeys(buildRequest(p), [free], false);
  return buildResult(p, response, keyTier);
}
