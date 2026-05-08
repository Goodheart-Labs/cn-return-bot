/**
 * Does Gemini's native API accept googleSearch + responseSchema in one call?
 *
 * If yes → searchWithGeminiNative is one call: prompt + tools:[googleSearch] +
 *           responseMimeType:json + responseSchema.
 * If no  → we'll need 2 calls (search-grounded then JSON-format) or
 *           prompt-only JSON without schema enforcement.
 */

import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-3-flash-preview";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    findings: { type: "STRING" },
    correction_needed: { type: "BOOLEAN" },
  },
  required: ["findings", "correction_needed"],
};

const PROMPT = `You are fact-checking. Use web search.
Tweet: "Tokyo's population is now 8 million."
Return JSON with findings (with URLs inline) and correction_needed.`;

async function tryBothAtOnce(): Promise<void> {
  console.log("\n--- A: googleSearch + responseSchema together ---");
  try {
    const r = await ai.models.generateContent({
      model: MODEL,
      contents: PROMPT,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA as any,
      } as any,
    });
    console.log("OK. Text (first 600):", r.text?.slice(0, 600));
    console.log("Grounding chunks:", r.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0);
    console.log("Usage:", JSON.stringify(r.usageMetadata));
    try {
      const parsed = JSON.parse(r.text ?? "{}");
      console.log("Parsed JSON:", JSON.stringify(parsed).slice(0, 400));
    } catch (err: any) {
      console.log("JSON.parse FAILED:", err.message);
    }
  } catch (err: any) {
    console.log("FAILED:", err.message?.slice(0, 800));
  }
}

async function tryPromptOnlyJson(): Promise<void> {
  console.log("\n--- B: googleSearch only, ask for JSON in prompt ---");
  try {
    const r = await ai.models.generateContent({
      model: MODEL,
      contents: PROMPT + "\n\nIMPORTANT: respond with strict JSON only, no prose.",
      config: { tools: [{ googleSearch: {} }] },
    });
    console.log("OK. Text (first 600):", r.text?.slice(0, 600));
    console.log("Grounding chunks:", r.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0);
    try {
      // Strip ```json ... ``` if present
      const cleaned = (r.text ?? "").replace(/^```json\n?|\n?```$/g, "").trim();
      const parsed = JSON.parse(cleaned);
      console.log("Parsed JSON:", JSON.stringify(parsed).slice(0, 400));
    } catch (err: any) {
      console.log("JSON.parse FAILED:", err.message);
    }
  } catch (err: any) {
    console.log("FAILED:", err.message?.slice(0, 800));
  }
}

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set");
    process.exit(1);
  }
  await tryBothAtOnce();
  await tryPromptOnlyJson();
}

main();
