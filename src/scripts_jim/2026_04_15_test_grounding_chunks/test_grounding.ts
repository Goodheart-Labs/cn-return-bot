/**
 * Test: does includeServerSideToolInvocations suppress groundingChunks?
 *
 * Compares googleSearch grounding with and without custom tools + serverSideToolInvocations.
 * If chunks disappear with the flag, that explains why the pipeline has no annotations.
 */

import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-3-flash-preview";

const CUSTOM_TOOL = {
  functionDeclarations: [
    {
      name: "grok_search",
      description: "Search X/Twitter for related tweets.",
      parameters: {
        type: "OBJECT" as any,
        properties: {
          query: { type: "STRING" as any, description: "Search query." },
        },
        required: ["query"],
      },
    },
  ],
};

const PROMPT = "What is the current population of Tokyo? Be brief.";

function summarizeGrounding(response: any) {
  const candidate = response.candidates?.[0];
  const grounding = candidate?.groundingMetadata;
  const parts = candidate?.content?.parts ?? [];

  const partTypes = parts.map((p: any) => {
    const keys = Object.keys(p).filter(k => k !== "thoughtSignature");
    return keys.join("+");
  });

  console.log(`  Part types: [${partTypes.join(", ")}]`);
  console.log(`  Text: ${response.text?.slice(0, 120)}...`);

  if (grounding) {
    console.log(`  webSearchQueries: ${grounding.webSearchQueries?.length ?? 0}`);
    console.log(`  groundingChunks: ${grounding.groundingChunks?.length ?? 0}`);
    console.log(`  groundingSupports: ${grounding.groundingSupports?.length ?? 0}`);
    if (grounding.groundingChunks?.length) {
      for (const chunk of grounding.groundingChunks) {
        console.log(`    - ${chunk.web?.title}: ${chunk.web?.uri?.slice(0, 80)}`);
      }
    }
  } else {
    console.log("  NO groundingMetadata");
  }

  // Check for toolCall parts (server-side invocations)
  const toolCallParts = parts.filter((p: any) => p.toolCall);
  if (toolCallParts.length) {
    console.log(`  toolCall parts: ${toolCallParts.length}`);
    for (const p of toolCallParts) {
      console.log(`    type=${p.toolCall.toolType}, queries=${JSON.stringify(p.toolCall.args?.queries?.slice(0, 3))}`);
    }
  }

  // Check for toolResult/toolResponse parts — dump their content
  const toolResultParts = parts.filter((p: any) => p.toolResult || p.toolResponse);
  if (toolResultParts.length) {
    console.log(`  toolResult parts: ${toolResultParts.length}`);
    for (const p of toolResultParts) {
      const data = p.toolResult ?? p.toolResponse;
      console.log(`    keys: ${Object.keys(data)}`);
      const json = JSON.stringify(data);
      // Skip the HTML search_suggestions, show actual data keys
      const responseObj = data.response ?? data;
      const responseKeys = Object.keys(responseObj);
      console.log(`    response keys: ${responseKeys}`);
      for (const key of responseKeys) {
        if (key === "search_suggestions") {
          console.log(`    search_suggestions: (HTML, ${responseObj[key]?.length} chars)`);
        } else {
          const val = JSON.stringify(responseObj[key]);
          console.log(`    ${key}: ${val?.slice(0, 500)}`);
        }
      }
    }
  }
}

// Test A: googleSearch only (no custom tools)
async function testA() {
  console.log("\n=== A: googleSearch ONLY (no custom tools) ===");
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: PROMPT,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });
  summarizeGrounding(response);
}

// Test B: googleSearch + custom tool, WITH includeServerSideToolInvocations
async function testB() {
  console.log("\n=== B: googleSearch + custom tool + includeServerSideToolInvocations ===");
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: PROMPT,
    config: {
      tools: [{ googleSearch: {} }, CUSTOM_TOOL],
      toolConfig: { includeServerSideToolInvocations: true } as any,
    },
  });
  summarizeGrounding(response);
}

// Test C: googleSearch + custom tool, WITHOUT includeServerSideToolInvocations
async function testC() {
  console.log("\n=== C: googleSearch + custom tool, NO includeServerSideToolInvocations ===");
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: PROMPT,
    config: {
      tools: [{ googleSearch: {} }, CUSTOM_TOOL],
    },
  });
  summarizeGrounding(response);
}

// Test D: Pipeline-realistic — system prompt + complex user message + multiple custom tools
async function testD() {
  console.log("\n=== D: Pipeline-realistic (system + tools + complex prompt) ===");
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `You are a research agent. Investigate whether this tweet is misleading.

Tweet: "BREAKING: Hot air balloon carrying 21 people catches fire and crashes in southern Brazil, killing at least 8"
Posted: 2026-04-15

Comments say this happened in June 2025, not April 2026.

Use your search tools to verify. Then call send_message with your findings, or no_correction_needed.` }],
      },
    ],
    config: {
      systemInstruction: "You are a research agent for fact-checking. Use search tools to find evidence.",
      tools: [
        { googleSearch: {} },
        {
          functionDeclarations: [
            {
              name: "grok_search",
              description: "Search X/Twitter for related tweets.",
              parameters: {
                type: "OBJECT" as any,
                properties: { query: { type: "STRING" as any } },
                required: ["query"],
              },
            },
            {
              name: "send_message",
              description: "Send findings to the notewriter. This ends your turn.",
              parameters: {
                type: "OBJECT" as any,
                properties: {
                  to: { type: "STRING" as any, enum: ["notewriter"] },
                  message: { type: "STRING" as any },
                },
                required: ["to", "message"],
              },
            },
            {
              name: "no_correction_needed",
              description: "Call when no correction is needed.",
              parameters: {
                type: "OBJECT" as any,
                properties: { reason: { type: "STRING" as any } },
                required: ["reason"],
              },
            },
          ],
        },
      ],
      toolConfig: { includeServerSideToolInvocations: true } as any,
    },
  });
  summarizeGrounding(response);

  // Also show function calls
  const fc = response.functionCalls;
  if (fc?.length) {
    console.log(`  functionCalls: ${fc.map((f: any) => f.name).join(", ")}`);
  }
}

for (const [name, fn] of [
  ["A", testA],
  ["B", testB],
  ["C", testC],
  ["D", testD],
] as const) {
  try {
    await (fn as () => Promise<void>)();
  } catch (err: any) {
    console.error(`Test ${name} FAILED: ${err.message?.slice(0, 300)}`);
  }
}
