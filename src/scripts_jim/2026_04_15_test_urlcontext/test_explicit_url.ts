/**
 * Test: Does urlContext fetch URLs the model mentions in its own text output
 * in a subsequent turn?
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-3-flash-preview";
const TEST_URL = "https://forum.effectivealtruism.org/posts/ychu2LAw54sNcocKH/the-anthropic-ipo-is-coming-we-aren-t-ready-for-it";

async function main() {
  const tools = [
    { urlContext: {} },
    {
      functionDeclarations: [{
        name: "dummy",
        description: "A dummy tool",
        parameters: { type: "OBJECT", properties: { x: { type: "STRING" } } },
      }],
    },
  ];

  // Turn 1: model outputs a URL in text
  const contents: any[] = [
    { role: "user", parts: [{ text: "What is the EA Forum? Reply briefly, and include a link to an article." }] },
    { role: "model", parts: [{ text: `The EA Forum is a community platform for discussion. Here's a relevant article: ${TEST_URL}` }] },
    { role: "user", parts: [{ text: `Now please read and summarize the article at ${TEST_URL}. Tell me the key points.` }] },
  ];

  console.log("--- Sending request with URL in conversation history ---");
  const r = await client.models.generateContent({
    model: MODEL,
    contents,
    config: {
      tools,
      toolConfig: { includeServerSideToolInvocations: true },
    },
  });

  const c = r.candidates?.[0];
  console.log("urlContextMetadata:", JSON.stringify(c?.urlContextMetadata, null, 2));
  console.log("groundingMetadata:", JSON.stringify(c?.groundingMetadata, null, 2)?.slice(0, 500));
  console.log("parts:");
  for (const p of c?.content?.parts ?? []) {
    if (p.text) console.log(`  text: ${p.text.slice(0, 200)}`);
    else if (p.thoughtSignature) console.log(`  thoughtSignature: (present)`);
    else console.log(`  other:`, JSON.stringify(p).slice(0, 200));
  }
}

main().catch(console.error);
