/**
 * Test: Does urlContext auto-fetch URLs found by googleSearch?
 * Simulates the real pipeline flow: model searches, finds URLs, should then fetch them.
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-3-flash-preview";

async function main() {
  const tools = [
    { urlContext: {} },
    { googleSearch: {} },
    {
      functionDeclarations: [{
        name: "submit_answer",
        description: "Submit your verified answer with source URL",
        parameters: {
          type: "OBJECT",
          properties: {
            answer: { type: "STRING" },
            source_url: { type: "STRING" },
          },
          required: ["answer", "source_url"],
        },
      }],
    },
  ];

  const contents: any[] = [
    {
      role: "user",
      parts: [{
        text: `Search for information about the Anthropic IPO and EA Forum discussions about it.
Find the relevant EA Forum article URL. Then FETCH that URL to verify its contents before submitting.
You MUST use urlContext to fetch and read the article before answering.
Call submit_answer with a summary and the source URL.`,
      }],
    },
  ];

  console.log("--- Turn 1 ---");
  const r1 = await client.models.generateContent({
    model: MODEL,
    contents,
    config: {
      tools,
      toolConfig: { includeServerSideToolInvocations: true },
    },
  });

  const c1 = r1.candidates?.[0];
  console.log("urlContextMetadata:", JSON.stringify(c1?.urlContextMetadata, null, 2));
  console.log("groundingMetadata queries:", JSON.stringify(c1?.groundingMetadata?.webSearchQueries));
  console.log("groundingChunks:", JSON.stringify(c1?.groundingMetadata?.groundingChunks?.map((c: any) => c.web), null, 2));
  console.log("parts:");
  for (const p of c1?.content?.parts ?? []) {
    if (p.text) console.log(`  text: ${p.text.slice(0, 200)}`);
    else if (p.functionCall) console.log(`  functionCall: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, 200)})`);
    else if (p.thoughtSignature) console.log(`  thoughtSignature: (present)`);
    else console.log(`  other:`, JSON.stringify(p).slice(0, 200));
  }

  // Multi-turn if there's a function call
  const fc = c1?.content?.parts?.find((p: any) => p.functionCall);
  if (fc) {
    console.log("\n--- Turn 2: sending function response, asking model to now fetch the URL ---");
    contents.push({ role: "model", parts: c1!.content!.parts });
    contents.push({
      role: "user",
      parts: [{ functionResponse: { name: fc.functionCall.name, response: { status: "submitted" }, id: fc.functionCall.id } }],
    });

    const r2 = await client.models.generateContent({
      model: MODEL,
      contents,
      config: {
        tools,
        toolConfig: { includeServerSideToolInvocations: true },
      },
    });

    const c2 = r2.candidates?.[0];
    console.log("urlContextMetadata:", JSON.stringify(c2?.urlContextMetadata, null, 2));
    console.log("parts:");
    for (const p of c2?.content?.parts ?? []) {
      if (p.text) console.log(`  text: ${p.text.slice(0, 200)}`);
      else if (p.functionCall) console.log(`  functionCall: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, 200)})`);
      else if (p.thoughtSignature) console.log(`  thoughtSignature: (present)`);
      else console.log(`  other:`, JSON.stringify(p).slice(0, 200));
    }
  }
}

main().catch(console.error);
