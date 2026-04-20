/**
 * Test Google Gemini API directly (NOT OpenRouter):
 * 1. Native googleSearch (grounding)
 * 2. Native urlContext (URL fetching)
 * 3. Custom function calling
 * 4. Combined: googleSearch + urlContext + custom function
 *
 * Goal: understand response shapes, cost tracking, tool call patterns
 */

import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-3-flash-preview";

function dump(label: string, response: any) {
  console.log(`\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}`);

  // Text output
  console.log("\n--- Text ---");
  console.log(response.text?.slice(0, 500));

  // Usage metadata
  console.log("\n--- Usage metadata ---");
  console.log(JSON.stringify(response.usageMetadata, null, 2));

  // Function calls (if any)
  if (response.functionCalls?.length) {
    console.log("\n--- Function calls ---");
    for (const fc of response.functionCalls) {
      console.log(`  ${fc.name}(${JSON.stringify(fc.args).slice(0, 200)}) | id: ${fc.id}`);
    }
  }

  // Grounding metadata (from googleSearch)
  const grounding = response.candidates?.[0]?.groundingMetadata;
  if (grounding) {
    console.log("\n--- Grounding metadata ---");
    if (grounding.webSearchQueries?.length) {
      console.log("Search queries:", grounding.webSearchQueries);
    }
    if (grounding.groundingChunks?.length) {
      console.log("Grounding chunks:");
      for (const chunk of grounding.groundingChunks.slice(0, 5)) {
        console.log(`  - ${chunk.web?.title} | ${chunk.web?.uri?.slice(0, 100)}`);
      }
      if (grounding.groundingChunks.length > 5) {
        console.log(`  ... and ${grounding.groundingChunks.length - 5} more`);
      }
    }
    if (grounding.groundingSupports?.length) {
      console.log("Grounding supports (first 3):");
      for (const s of grounding.groundingSupports.slice(0, 3)) {
        console.log(`  "${s.segment?.text?.slice(0, 80)}..." → chunks [${s.groundingChunkIndices}] conf: [${s.confidenceScores?.map((c: number) => c.toFixed(2))}]`);
      }
    }
    if (grounding.searchEntryPoint) {
      console.log("Search entry point: (HTML snippet present, length:", grounding.searchEntryPoint.renderedContent?.length, ")");
    }
  }

  // URL context metadata (from urlContext)
  const urlCtx = response.candidates?.[0]?.urlContextMetadata;
  if (urlCtx) {
    console.log("\n--- URL context metadata ---");
    console.log(JSON.stringify(urlCtx, null, 2));
  }

  // Raw candidate content parts
  const parts = response.candidates?.[0]?.content?.parts;
  if (parts?.length) {
    console.log("\n--- Content parts ---");
    for (const part of parts) {
      if (part.text) {
        console.log(`[text] ${part.text.slice(0, 200)}`);
      } else if (part.functionCall) {
        console.log(`[functionCall] ${part.functionCall.name}(${JSON.stringify(part.functionCall.args).slice(0, 200)}) | id: ${part.functionCall.id}`);
      } else if (part.toolCall) {
        console.log(`[toolCall] type: ${part.toolCall.toolType} | id: ${part.toolCall.id}`);
      } else if (part.toolResponse) {
        console.log(`[toolResponse] type: ${part.toolResponse.toolType}`);
      } else {
        console.log(`[${Object.keys(part).join(",")}]`, JSON.stringify(part).slice(0, 200));
      }
    }
  }

  // Full raw for deep inspection
  console.log("\n--- Full raw JSON (truncated) ---");
  console.log(JSON.stringify(response, null, 2));
}

// --- Test 1: googleSearch (grounding) ---
async function testGoogleSearch() {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: "What is the current population of Tokyo? Be brief.",
    config: {
      tools: [{ googleSearch: {} }],
    },
  });
  dump("Test 1: googleSearch (grounding)", response);
}

// --- Test 2: urlContext ---
async function testUrlContext() {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: "Fetch https://httpbin.org/json and tell me what keys the JSON has. Be brief.",
    config: {
      tools: [{ urlContext: {} }],
    },
  });
  dump("Test 2: urlContext", response);
}

// --- Test 3: Custom function calling ---
async function testCustomFunction() {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: "Search for: latest news about AI regulation",
    config: {
      tools: [
        {
          functionDeclarations: [
            {
              name: "perplexity_search",
              description: "Search the web using Perplexity AI.",
              parameters: {
                type: "OBJECT" as any,
                properties: {
                  query: { type: "STRING" as any, description: "The search query." },
                },
                required: ["query"],
              },
            },
          ],
        },
      ],
    },
  });
  dump("Test 3: Custom function (perplexity_search)", response);

  // If it requested the function, send the result back
  const fc = response.functionCalls?.[0];
  if (fc) {
    console.log("\n→ Gemini requested function, sending result back...");
    const followup = await ai.models.generateContent({
      model: MODEL,
      contents: [
        { role: "user", parts: [{ text: "Search for: latest news about AI regulation" }] },
        response.candidates![0].content!,
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: fc.name,
                response: { results: "The EU AI Act entered force in August 2025. The US has proposed new executive orders." },
                id: fc.id,
              },
            },
          ],
        },
      ],
      config: {
        tools: [
          {
            functionDeclarations: [
              {
                name: "perplexity_search",
                description: "Search the web using Perplexity AI.",
                parameters: {
                  type: "OBJECT" as any,
                  properties: {
                    query: { type: "STRING" as any, description: "The search query." },
                  },
                  required: ["query"],
                },
              },
            ],
          },
        ],
      },
    });
    dump("Test 3b: After function result", followup);
  }
}

// --- Test 4: Combined googleSearch + custom function ---
async function testCombined() {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: "First search the web for 'Tokyo population 2026', then use grok_search to find related tweets. Be brief." }],
      },
    ],
    config: {
      tools: [
        { googleSearch: {} },
        {
          functionDeclarations: [
            {
              name: "grok_search",
              description: "Search X/Twitter for related tweets.",
              parameters: {
                type: "OBJECT" as any,
                properties: {
                  query: { type: "STRING" as any, description: "What to search for on X." },
                },
                required: ["query"],
              },
            },
          ],
        },
      ],
      toolConfig: {
        // Enable context circulation so googleSearch results are available to custom functions
        includeServerSideToolInvocations: true,
      } as any,
    },
  });
  dump("Test 4: Combined googleSearch + custom grok_search", response);
}

// --- Test 5: googleSearch + urlContext together ---
async function testSearchAndUrl() {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: "Find articles about Tokyo population growth and summarize the first result. Check https://en.wikipedia.org/wiki/Tokyo too. Be brief.",
    config: {
      tools: [
        { googleSearch: {} },
        { urlContext: {} },
      ],
    },
  });
  dump("Test 5: googleSearch + urlContext combined", response);
}

// --- Run all ---
const tests = [
  ["1: googleSearch", testGoogleSearch],
  // ["2: urlContext", testUrlContext],
  // ["3: custom function", testCustomFunction],
  // ["4: combined search + custom", testCombined],
  // ["5: googleSearch + urlContext", testSearchAndUrl],
] as const;

for (const [name, fn] of tests) {
  console.log(`\n>>> Running test ${name}...`);
  try {
    await (fn as () => Promise<void>)();
  } catch (err: any) {
    console.error(`FAILED: ${err.message?.slice(0, 500)}`);
    if (err.status) console.error("Status:", err.status);
    if (err.errorDetails) console.error("Details:", JSON.stringify(err.errorDetails).slice(0, 500));
  }
}
