/**
 * Control test: Does urlContext activate on URLs in a non-first user message?
 * No googleSearch, no function tools — just two user turns.
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-3-flash-preview";
const URL = "https://forum.effectivealtruism.org/posts/ychu2LAw54sNcocKH/the-anthropic-ipo-is-coming-we-aren-t-ready-for-it";

async function main() {
  console.log("=== Test A: URL in first user message ===");
  const rA = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: `Summarize: ${URL}` }] }],
    config: { tools: [{ urlContext: {} }] },
  });
  const cA = rA.candidates?.[0];
  console.log("urlContext:", cA?.urlContextMetadata?.urlMetadata?.length ? "ACTIVATED" : "(none)");

  console.log("\n=== Test B: URL in second user message ===");
  const rB = await client.models.generateContent({
    model: MODEL,
    contents: [
      { role: "user", parts: [{ text: "Hello, I need help fact-checking something." }] },
      { role: "model", parts: [{ text: "Sure, how can I help?" }] },
      { role: "user", parts: [{ text: `Please fetch and summarize this article: ${URL}` }] },
    ],
    config: { tools: [{ urlContext: {} }] },
  });
  const cB = rB.candidates?.[0];
  console.log("urlContext:", cB?.urlContextMetadata?.urlMetadata?.length ? "ACTIVATED" : "(none)");

  console.log("\n=== Test C: URL in third user message (after function call) ===");
  const rC = await client.models.generateContent({
    model: MODEL,
    contents: [
      { role: "user", parts: [{ text: "Search for EA Forum articles about Anthropic." }] },
      { role: "model", parts: [{ text: "I found an article about the Anthropic IPO on the EA Forum." }] },
      { role: "user", parts: [{ text: `Great, now please read this URL and tell me what it says: ${URL}` }] },
    ],
    config: { tools: [{ urlContext: {} }] },
  });
  const cC = rC.candidates?.[0];
  console.log("urlContext:", cC?.urlContextMetadata?.urlMetadata?.length ? "ACTIVATED" : "(none)");

  console.log("\n=== Test D: URL only in functionResponse ===");
  const rD = await client.models.generateContent({
    model: MODEL,
    contents: [
      { role: "user", parts: [{ text: "I need to verify a source." }] },
      { role: "model", parts: [{ functionCall: { name: "get_url", args: {}, id: "fc1" } }] },
      { role: "user", parts: [{ functionResponse: { name: "get_url", response: { url: URL }, id: "fc1" } }] },
    ],
    config: {
      tools: [
        { urlContext: {} },
        { functionDeclarations: [{ name: "get_url", description: "Get URL", parameters: { type: "OBJECT", properties: {} } }] },
      ],
      toolConfig: { includeServerSideToolInvocations: true },
    },
  });
  const cD = rD.candidates?.[0];
  console.log("urlContext:", cD?.urlContextMetadata?.urlMetadata?.length ? "ACTIVATED" : "(none)");
}

main().catch(console.error);
