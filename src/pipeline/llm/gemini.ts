/**
 * Native Google Gen AI client.
 *
 * OpenRouter does not expose Gemini's googleSearch tool, so simple-bot
 * search variants targeting Gemini call this directly.
 */

import { GoogleGenAI } from "@google/genai";
import { calculateGeminiCost, type TokenCost } from "../utils/pricing";

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

  const response = await ai.models.generateContent({
    model: p.model,
    contents: p.userMessage,
    config: config as any,
  });

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
