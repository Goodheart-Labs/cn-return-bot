/**
 * Test Anthropic API directly (NOT OpenRouter):
 * 1. Native web_search (server-executed)
 * 2. Native web_fetch (server-executed)
 * 3. Custom tool calling (client-executed)
 * 4. Combined: native tools + custom tools in one call
 *
 * Goal: understand response shapes, cost tracking, tool call patterns
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

function dump(label: string, response: any) {
  console.log(`\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}`);

  // Usage / cost
  console.log("\n--- Usage ---");
  console.log(JSON.stringify(response.usage, null, 2));

  // Stop reason
  console.log("\nStop reason:", response.stop_reason);

  // Content blocks
  console.log("\n--- Content blocks ---");
  for (const block of response.content) {
    console.log(`\n[${block.type}]`);
    if (block.type === "text") {
      console.log("Text:", block.text?.slice(0, 300));
      if (block.citations?.length) {
        console.log("Citations:", JSON.stringify(block.citations.slice(0, 3), null, 2));
      }
    } else if (block.type === "tool_use") {
      console.log("Tool:", block.name, "| ID:", block.id);
      console.log("Input:", JSON.stringify(block.input).slice(0, 300));
    } else if (block.type === "server_tool_use") {
      console.log("Server tool:", block.name, "| ID:", block.id);
      console.log("Input:", JSON.stringify(block.input).slice(0, 300));
    } else if (block.type === "web_search_tool_result") {
      console.log("Tool use ID:", block.tool_use_id);
      const results = Array.isArray(block.content) ? block.content : [block.content];
      for (const r of results.slice(0, 3)) {
        if (r.type === "web_search_result") {
          console.log(`  - ${r.title} | ${r.url} | age: ${r.page_age}`);
        } else if (r.type === "web_search_tool_result_error") {
          console.log(`  ERROR: ${r.error_code}`);
        }
      }
      if (results.length > 3) console.log(`  ... and ${results.length - 3} more results`);
    } else if (block.type === "web_fetch_tool_result") {
      console.log("Tool use ID:", block.tool_use_id);
      const r = block.content;
      if (r?.type === "web_fetch_result") {
        console.log(`  URL: ${r.url}`);
        console.log(`  Title: ${r.content?.title}`);
        console.log(`  Content type: ${r.content?.source?.media_type}`);
        console.log(`  Content preview: ${r.content?.source?.data?.slice(0, 200)}`);
      } else {
        console.log("  Result:", JSON.stringify(r).slice(0, 300));
      }
    } else {
      console.log(JSON.stringify(block).slice(0, 400));
    }
  }

  // Full raw response for inspection
  console.log("\n--- Full raw JSON (truncated) ---");
  console.log(JSON.stringify(response, null, 2).slice(0, 3000));
}

// --- Test 1: Native web_search ---
async function testWebSearch() {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: "What is the current population of Tokyo? Be brief." }],
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 3 },
    ],
  });
  dump("Test 1: Native web_search", response);
}

// --- Test 2: Native web_fetch ---
async function testWebFetch() {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      { role: "user", content: "Fetch https://httpbin.org/json and tell me what keys the JSON has. Be brief." },
    ],
    tools: [
      { type: "web_fetch_20250910" as any, name: "web_fetch", max_uses: 3 } as any,
    ],
  });
  dump("Test 2: Native web_fetch", response);
}

// --- Test 3: Custom tool calling ---
async function testCustomTool() {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      { role: "user", content: "Search for: latest news about AI regulation" },
    ],
    tools: [
      {
        name: "perplexity_search",
        description: "Search the web using Perplexity AI.",
        input_schema: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "The search query." },
          },
          required: ["query"],
        },
      },
    ],
  });
  dump("Test 3: Custom tool (perplexity_search)", response);

  // If it requested the tool, send back a fake result
  const toolUse = response.content.find((b: any) => b.type === "tool_use") as any;
  if (toolUse) {
    console.log("\n→ Claude requested tool, sending fake result back...");
    const followup = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        { role: "user", content: "Search for: latest news about AI regulation" },
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: "The EU AI Act entered force in August 2025. The US has proposed new executive orders on AI safety.",
            },
          ],
        },
      ],
      tools: [
        {
          name: "perplexity_search",
          description: "Search the web using Perplexity AI.",
          input_schema: {
            type: "object" as const,
            properties: {
              query: { type: "string", description: "The search query." },
            },
            required: ["query"],
          },
        },
      ],
    });
    dump("Test 3b: After tool result", followup);
  }
}

// --- Test 4: Combined native + custom tools ---
async function testCombined() {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: "First search the web for 'Tokyo population 2026', then use grok_search to find related tweets about it. Be brief.",
      },
    ],
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 3 },
      {
        name: "grok_search",
        description: "Search X/Twitter for related tweets.",
        input_schema: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "What to search for on X." },
          },
          required: ["query"],
        },
      },
    ],
  });
  dump("Test 4: Combined native web_search + custom grok_search", response);
}

// --- Run all ---
const tests = [
  ["1: web_search", testWebSearch],
  ["2: web_fetch", testWebFetch],
  ["3: custom tool", testCustomTool],
  ["4: combined tools", testCombined],
] as const;

for (const [name, fn] of tests) {
  console.log(`\n>>> Running test ${name}...`);
  try {
    await (fn as () => Promise<void>)();
  } catch (err: any) {
    console.error(`FAILED: ${err.message?.slice(0, 500)}`);
    if (err.status) console.error("Status:", err.status);
    if (err.error) console.error("Error body:", JSON.stringify(err.error).slice(0, 500));
  }
}
