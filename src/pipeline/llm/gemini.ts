/**
 * Native Google Gen AI client.
 *
 * OpenRouter does not expose Gemini's googleSearch tool, so simple-bot
 * search variants targeting Gemini call this directly.
 */

import { GoogleGenAI } from "@google/genai";
import { calculateGeminiCost, type TokenCost } from "../cost-tracking/pricing";

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 2000;

let _client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required but not set");
    }
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _client;
}

function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENETUNREACH") return true;
  // @google/genai's ApiError stuffs the HTTP status into the JSON message body
  // rather than exposing it as a field, so fall back to inspecting the text.
  const msg: string = err?.message ?? "";
  if (/"code"\s*:\s*(429|500|502|503|504)/.test(msg)) return true;
  if (/UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED/.test(msg)) return true;
  if (/operation timed out|timeout/i.test(msg)) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GeminiNativeParams {
  /** Model id without provider prefix, e.g. "gemini-3-flash-preview". */
  model: string;
  systemInstruction?: string;
  userMessage: string;
  enableGoogleSearch?: boolean;
  /** Gemini-flavoured JSON schema (uses uppercase types like "OBJECT", "STRING"). */
  responseSchema?: object;
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
}

export async function geminiNativeGenerate(p: GeminiNativeParams): Promise<GeminiNativeResult> {
  const ai = getClient();
  const config: Record<string, unknown> = {};
  if (p.systemInstruction) config.systemInstruction = p.systemInstruction;
  if (p.enableGoogleSearch) config.tools = [{ googleSearch: {} }];
  if (p.responseSchema) {
    config.responseMimeType = "application/json";
    config.responseSchema = p.responseSchema;
  }

  let response: any;
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: p.model,
        contents: p.userMessage,
        config: config as any,
      });
      break;
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[gemini] Retryable error (attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${p.model}): ${err?.status ?? err?.code} ${err?.message?.slice(0, 200)}. Retrying in ${backoff}ms...`,
        );
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  if (!response) throw lastError;

  const text = response.text ?? "";
  let parsed: any | undefined;
  if (p.responseSchema) {
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

  return { text, parsed, groundingChunks, searchCalls, cost };
}
