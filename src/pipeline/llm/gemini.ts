/**
 * Native Google Gen AI client.
 *
 * OpenRouter does not expose Gemini's googleSearch tool, so simple-bot
 * search variants targeting Gemini call this directly. Media analysis also
 * goes through here so it shares the free→paid key routing below.
 *
 * Key routing: `geminiNativeGenerate` tries GEMINI_API_KEY_FREE first (the AI
 * Studio free tier) and only falls back to the paid GEMINI_API_KEY when the free
 * key is out of quota (429 / RESOURCE_EXHAUSTED). Transient 5xx/network errors
 * retry on the same key with backoff; they don't burn the fallback. Free-tier
 * calls report cost as $0 (the tier is not billed) while keeping token counts.
 *
 * `geminiNativeGenerateFree` tries the free key only and fails fast on quota —
 * used by the trackedLlmCreate adapter, which routes any non-tooling gemini call
 * through the free key and falls back to OpenRouter (not the paid native key).
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

/** Keys to try in order: free tier first, paid as fallback. */
function geminiKeys(): GeminiKey[] {
  const keys: GeminiKey[] = [];
  if (process.env.GEMINI_API_KEY_FREE) keys.push({ apiKey: process.env.GEMINI_API_KEY_FREE, tier: "free" });
  if (process.env.GEMINI_API_KEY) keys.push({ apiKey: process.env.GEMINI_API_KEY, tier: "paid" });
  if (keys.length === 0) {
    throw new Error("GEMINI_API_KEY (or GEMINI_API_KEY_FREE) environment variable is required but not set");
  }
  return keys;
}

/** Free key only, or null when GEMINI_API_KEY_FREE is unset. Used by the
 *  trackedLlmCreate adapter, which tries free-native then falls back to
 *  OpenRouter (not the paid native key) since those calls need no native tooling. */
export function geminiFreeKey(): GeminiKey | null {
  return process.env.GEMINI_API_KEY_FREE
    ? { apiKey: process.env.GEMINI_API_KEY_FREE, tier: "free" }
    : null;
}

/** Free-tier quota exhaustion — the signal to fall back to the paid key. */
export function isQuotaError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 429) return true;
  const msg: string = err?.message ?? "";
  if (/"code"\s*:\s*429/.test(msg)) return true;
  if (/RESOURCE_EXHAUSTED/.test(msg)) return true;
  return false;
}

/** Transient errors worth retrying on the same key. */
function isTransientError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENETUNREACH") return true;
  // @google/genai's ApiError stuffs the HTTP status into the JSON message body
  // rather than exposing it as a field, so fall back to inspecting the text.
  const msg: string = err?.message ?? "";
  if (/"code"\s*:\s*(500|502|503|504)/.test(msg)) return true;
  if (/UNAVAILABLE|DEADLINE_EXCEEDED/.test(msg)) return true;
  if (/operation timed out|timeout/i.test(msg)) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Part of a multimodal user turn: plain text or inline media bytes. */
export type GeminiContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/** One conversation turn (system messages are passed separately as
 *  systemInstruction). "model" is Gemini's name for the assistant role. */
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
  /** Multimodal user turn (text + inline image/video bytes). Takes precedence over `userMessage`. */
  userParts?: GeminiContentPart[];
  /** Multi-turn text history (user/model). Takes precedence over userParts/userMessage. */
  userTurns?: GeminiTurn[];
  enableGoogleSearch?: boolean;
  /** Gemini-flavoured JSON schema (uses uppercase types like "OBJECT", "STRING"). */
  responseSchema?: object;
  /** When set, forces JSON output even without a schema (responseMimeType). */
  jsonOutput?: boolean;
  temperature?: number;
  thinkingLevel?: GeminiThinkingLevel;
}

export interface GeminiNativeResult {
  /** Raw text body (already JSON-formatted when responseSchema is set). */
  text: string;
  parsed?: any;
  /** Web grounding citations from googleSearch, when enabled. */
  groundingChunks: { uri?: string; title?: string }[];
  /** Number of webSearchQueries Gemini issued during the call. */
  searchCalls: number;
  cost: TokenCost;
  /** Which key tier served the request. Free-tier cost is reported as $0. */
  keyTier: "free" | "paid";
}

/** Run generateContent on one key, retrying transient errors (and, on the last
 *  key, quota errors too) with backoff. Quota errors on a non-final key throw
 *  immediately so the caller can switch keys instead of waiting out the limit. */
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

/** Run the request against keys in order, falling back to the next key on quota
 *  exhaustion. `retryQuotaOnLastKey` controls whether the final key waits out a
 *  quota error with backoff (true for the paid fallback in geminiNativeGenerate)
 *  or fails fast (false for the free-only adapter path, which falls to OpenRouter). */
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
      // Caller can still inspect text; no throw here so cost tracking still records.
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
  // AI Studio free tier is not billed; keep token counts for visibility but zero the charge.
  if (keyTier === "free") cost.cost = 0;

  return { text, parsed, groundingChunks, searchCalls, cost, keyTier };
}

/** Free key first, paid key as quota fallback. */
export async function geminiNativeGenerate(p: GeminiNativeParams): Promise<GeminiNativeResult> {
  const { response, keyTier } = await runKeys(buildRequest(p), geminiKeys(), true);
  return buildResult(p, response, keyTier);
}

/** Free key ONLY. Throws on quota (no backoff) so the caller can fall back to
 *  OpenRouter immediately. Throws if GEMINI_API_KEY_FREE is unset. */
export async function geminiNativeGenerateFree(p: GeminiNativeParams): Promise<GeminiNativeResult> {
  const free = geminiFreeKey();
  if (!free) throw new Error("GEMINI_API_KEY_FREE is required but not set");
  const { response, keyTier } = await runKeys(buildRequest(p), [free], false);
  return buildResult(p, response, keyTier);
}
