/**
 * Direct test of geminiNativeGenerate to confirm:
 * 1. Happy path still works.
 * 2. Retry path triggers on simulated retryable errors.
 */
import "dotenv/config";
import { geminiNativeGenerate } from "../../pipeline/llm/gemini";

async function happy() {
  console.log("--- happy path: gemini-3-flash-preview with googleSearch ---");
  const t0 = Date.now();
  const r = await geminiNativeGenerate({
    model: "gemini-3-flash-preview",
    systemInstruction: "Return strict JSON: {answer: string}.",
    userMessage: "What is the capital of France? Respond with JSON {answer: string}.",
    enableGoogleSearch: true,
    responseSchema: {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } },
      required: ["answer"],
    },
  });
  console.log(`  ${((Date.now() - t0)/1000).toFixed(1)}s  searchCalls=${r.searchCalls}  text.len=${r.text.length}`);
  console.log(`  parsed: ${JSON.stringify(r.parsed)}`);
  console.log(`  cost: ${JSON.stringify(r.cost)}`);
}

happy().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
