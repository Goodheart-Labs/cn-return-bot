/**
 * Test Gemini 3 Flash through OpenRouter:
 * 1. Basic completion
 * 2. Native web search (google_search tool)
 * 3. Function calling (web_fetch as custom tool)
 */

import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL = "google/gemini-3-flash-preview";

function printResult(label: string, result: any) {
  console.log(`\n${"=".repeat(60)}\n${label}\n${"=".repeat(60)}`);
  const msg = result.choices?.[0]?.message;
  console.log("Content:", msg?.content?.slice(0, 500));
  console.log("Tool calls:", JSON.stringify(msg?.tool_calls?.map((tc: any) => ({
    name: tc.function?.name ?? tc.type,
    args: tc.function?.arguments?.slice(0, 200),
  })), null, 2));
  console.log("Annotations:", JSON.stringify(result.choices?.[0]?.message?.annotations?.slice(0, 3), null, 2));
  console.log("Usage:", JSON.stringify(result.usage));
}

// 1. Basic completion
async function testBasic() {
  const result = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: "What is 2+2? Answer in one word." }],
  });
  printResult("Basic completion", result);
}

// 2. Native web search via google_search tool
async function testWebSearch() {
  const result = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: "What major news happened today, April 6 2026? Summarize briefly." }],
    tools: [{ type: "google_search" as any, name: "google_search" } as any],
  } as any);
  printResult("Web search (google_search tool)", result);
}

// 2b. Try Claude-style web_search tool name (in case OpenRouter normalizes)
async function testWebSearchClaude() {
  const result = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: "What major news happened today, April 6 2026?" }],
    tools: [{ type: "web_search_20260209" as any, name: "web_search" } as any],
  } as any);
  printResult("Web search (Claude-style web_search_20260209)", result);
}

// 3. Function calling with web_fetch tool
async function testFunctionCalling() {
  const result = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "user", content: "Fetch the content of https://httpbin.org/json and tell me what keys the JSON has." },
    ],
    tools: [
      {
        type: "function" as const,
        function: {
          name: "web_fetch",
          description: "Fetch a URL and return its content.",
          parameters: {
            type: "object" as const,
            properties: {
              url: { type: "string" as const, description: "The URL to fetch." },
            },
            required: ["url"],
          },
        },
      },
    ],
  });
  printResult("Function calling (web_fetch)", result);

  // If it made a tool call, simulate the response
  const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall) {
    console.log("\n→ Gemini requested web_fetch, sending tool result back...");
    const followup = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "user", content: "Fetch the content of https://httpbin.org/json and tell me what keys the JSON has." },
        result.choices[0].message as any,
        {
          role: "tool" as any,
          tool_call_id: toolCall.id,
          content: JSON.stringify({ slideshow: { author: "Yours Truly", date: "date of publication", slides: [], title: "Sample Slide Show" } }),
        } as any,
      ],
      tools: [
        {
          type: "function" as const,
          function: {
            name: "web_fetch",
            description: "Fetch a URL and return its content.",
            parameters: {
              type: "object" as const,
              properties: {
                url: { type: "string" as const, description: "The URL to fetch." },
              },
              required: ["url"],
            },
          },
        },
      ],
    });
    printResult("Function calling (followup after tool result)", followup);
  }
}

// Run all tests
for (const [name, fn] of [
  ["Basic", testBasic],
  ["Web Search (google_search)", testWebSearch],
  ["Web Search (Claude-style)", testWebSearchClaude],
  ["Function Calling", testFunctionCalling],
] as const) {
  console.log(`\n>>> Running: ${name}`);
  try {
    await (fn as () => Promise<void>)();
  } catch (err: any) {
    console.error(`FAILED: ${err.message?.slice(0, 300)}`);
    if (err.error) console.error("Error body:", JSON.stringify(err.error).slice(0, 500));
  }
}
