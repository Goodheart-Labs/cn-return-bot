/**
 * Verify GEMINI_API_KEY_FREE authenticates with the native @google/genai client
 * and can run a generateContent call against gemini-3-flash-preview. Compares
 * against the paid GEMINI_API_KEY so we know the free→paid fallback is viable.
 */
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3-flash-preview";

async function probe(label: string, apiKey: string | undefined): Promise<void> {
  if (!apiKey) {
    console.log(`${label}: (not set)`);
    return;
  }
  const masked = `${apiKey.slice(0, 8)}…(${apiKey.length} chars)`;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: "Reply with the single word: pong",
    });
    console.log(`${label} [${masked}]: OK -> ${JSON.stringify(res.text?.slice(0, 60))}`);
  } catch (err: any) {
    console.log(`${label} [${masked}]: ERROR -> ${err?.status ?? err?.code ?? ""} ${String(err?.message ?? err).slice(0, 300)}`);
  }
}

await probe("FREE", process.env.GEMINI_API_KEY_FREE);
await probe("PAID", process.env.GEMINI_API_KEY);
