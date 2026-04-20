/**
 * Test urlContext in multi-turn with functionDeclarations (simulates agent loop).
 * Does urlContext activate when combined with custom function tools?
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-3-flash-preview";
const TEST_URL = "https://forum.effectivealtruism.org/posts/ychu2LAw54sNcocKH/the-anthropic-ipo-is-coming-we-aren-t-ready-for-it";

async function main() {
  console.log("=== Test: multi-turn with urlContext + googleSearch + functionDeclarations ===\n");

  const tools = [
    { urlContext: {} },
    { googleSearch: {} },
    {
      functionDeclarations: [{
        name: "submit_answer",
        description: "Submit your final answer",
        parameters: { type: "OBJECT", properties: { answer: { type: "STRING" } }, required: ["answer"] },
      }],
    },
  ];

  const contents: any[] = [
    {
      role: "user",
      parts: [{ text: `Please fetch the content at this URL: ${TEST_URL}\nThen call submit_answer with a one-sentence summary.` }],
    },
  ];

  // Turn 1: expecting urlContext to activate + function call
  console.log("--- Turn 1: sending user message ---");
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
  console.log("groundingMetadata queries:", c1?.groundingMetadata?.webSearchQueries);
  console.log("parts:");
  for (const p of c1?.content?.parts ?? []) {
    if (p.text) console.log(`  text: ${p.text.slice(0, 150)}`);
    else if (p.functionCall) console.log(`  functionCall: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args)})`);
    else if (p.thoughtSignature) console.log(`  thoughtSignature: (present)`);
    else console.log(`  other:`, JSON.stringify(p).slice(0, 200));
  }

  // If there's a function call, do turn 2
  const functionCallPart = c1?.content?.parts?.find((p: any) => p.functionCall);
  if (functionCallPart) {
    console.log("\n--- Turn 2: sending function response ---");
    contents.push({ role: "model", parts: c1!.content!.parts });
    contents.push({
      role: "user",
      parts: [{ functionResponse: { name: functionCallPart.functionCall.name, response: { status: "ok" }, id: functionCallPart.functionCall.id } }],
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
      if (p.text) console.log(`  text: ${p.text.slice(0, 150)}`);
      else if (p.functionCall) console.log(`  functionCall: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args)})`);
      else if (p.thoughtSignature) console.log(`  thoughtSignature: (present)`);
      else console.log(`  other:`, JSON.stringify(p).slice(0, 200));
    }
  } else {
    console.log("\nNo function call in turn 1 — model responded directly.");
  }
}

main().catch(console.error);
