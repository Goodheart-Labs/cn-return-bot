/**
 * Minimal test: does Gemini urlContext actually return urlContextMetadata?
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const TEST_URL = "https://forum.effectivealtruism.org/posts/ychu2LAw54sNcocKH/the-anthropic-ipo-is-coming-we-aren-t-ready-for-it";

async function main() {
  console.log("=== Test 1: urlContext only ===");
  const r1 = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: `Fetch this URL and summarize it: ${TEST_URL}` }] }],
    config: {
      tools: [{ urlContext: {} }],
    },
  });
  console.log("\n--- urlContextMetadata ---");
  console.log(JSON.stringify(r1.candidates?.[0]?.urlContextMetadata, null, 2));
  console.log("\n--- groundingMetadata ---");
  console.log(JSON.stringify(r1.candidates?.[0]?.groundingMetadata, null, 2));
  console.log("\n--- parts summary ---");
  for (const p of r1.candidates?.[0]?.content?.parts ?? []) {
    if (p.text) console.log(`  text: ${p.text.slice(0, 120)}...`);
    else console.log(`  other part:`, JSON.stringify(p).slice(0, 200));
  }

  console.log("\n=== Test 2: urlContext + googleSearch + functionDeclarations ===");
  const r2 = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: `Fetch this URL and summarize the key points: ${TEST_URL}` }] }],
    config: {
      tools: [
        { urlContext: {} },
        { googleSearch: {} },
        { functionDeclarations: [{ name: "dummy_tool", description: "A dummy tool", parameters: { type: "OBJECT", properties: { x: { type: "STRING" } } } }] },
      ],
      toolConfig: { includeServerSideToolInvocations: true },
    },
  });
  console.log("\n--- urlContextMetadata ---");
  console.log(JSON.stringify(r2.candidates?.[0]?.urlContextMetadata, null, 2));
  console.log("\n--- groundingMetadata ---");
  console.log(JSON.stringify(r2.candidates?.[0]?.groundingMetadata, null, 2));
  console.log("\n--- parts summary ---");
  for (const p of r2.candidates?.[0]?.content?.parts ?? []) {
    if (p.text) console.log(`  text: ${p.text.slice(0, 120)}...`);
    else console.log(`  other part:`, JSON.stringify(p).slice(0, 200));
  }

  console.log("\n=== Full raw response (test 2) ===");
  console.log(JSON.stringify(r2, null, 2));
}

main().catch(console.error);
