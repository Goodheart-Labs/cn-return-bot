/**
 * Test: Does urlContext activate when URLs appear in a user text message
 * injected after a tool response?
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
      functionDeclarations: [
        {
          name: "gemini_web_fetch",
          description: "Request URL fetches for verification. The system will fetch and return the content.",
          parameters: {
            type: "OBJECT",
            properties: {
              urls: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "URLs to fetch",
              },
            },
            required: ["urls"],
          },
        },
        {
          name: "submit_answer",
          description: "Submit your final answer",
          parameters: {
            type: "OBJECT",
            properties: {
              answer: { type: "STRING" },
              source_url: { type: "STRING" },
            },
            required: ["answer", "source_url"],
          },
        },
      ],
    },
  ];

  const contents: any[] = [{
    role: "user",
    parts: [{
      text: `Search for the EA Forum article "The Anthropic IPO Is Coming. We Aren't Ready for It."
Then call gemini_web_fetch to verify the source. After verification, call submit_answer.`,
    }],
  }];

  for (let turn = 1; turn <= 5; turn++) {
    console.log(`\n=== Turn ${turn} ===`);
    const r = await client.models.generateContent({
      model: MODEL,
      contents,
      config: {
        tools,
        toolConfig: { includeServerSideToolInvocations: true },
      },
    });

    const c = r.candidates?.[0];
    const parts = c?.content?.parts ?? [];

    const urlCtx = c?.urlContextMetadata;
    if (urlCtx?.urlMetadata?.length) {
      console.log("  urlContextMetadata:");
      for (const m of urlCtx.urlMetadata) {
        console.log(`    ${m.retrievedUrl} -> ${m.urlRetrievalStatus}`);
      }
    } else {
      console.log("  urlContextMetadata: (none)");
    }

    for (const p of parts) {
      if (p.text) console.log(`  text: ${p.text.slice(0, 200)}`);
      else if (p.functionCall) console.log(`  functionCall: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args)})`);
      else if (p.thoughtSignature) { /* skip */ }
      else console.log(`  other:`, JSON.stringify(p).slice(0, 150));
    }

    const functionCalls = parts.filter((p: any) => p.functionCall);
    if (functionCalls.length === 0) break;

    contents.push({ role: "model", parts });

    for (const fc of functionCalls) {
      const name = fc.functionCall.name;
      const args = fc.functionCall.args;

      if (name === "gemini_web_fetch") {
        const urls = args.urls as string[];
        console.log(`  -> gemini_web_fetch called with: ${urls.join(", ")}`);

        // Send functionResponse first
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name,
              response: { status: "fetching" },
              id: fc.functionCall.id,
            },
          }],
        });

        // Then inject a user message with the URLs
        const urlText = urls.map((u: string) => `Verify the content at: ${u}`).join("\n");
        contents.push({
          role: "user",
          parts: [{ text: urlText }],
        });
      } else if (name === "submit_answer") {
        console.log(`  -> FINAL ANSWER:`);
        console.log(`     source_url: ${args.source_url}`);
        console.log(`     answer: ${args.answer?.slice(0, 200)}`);
        return;
      }
    }
  }
}

main().catch(console.error);
