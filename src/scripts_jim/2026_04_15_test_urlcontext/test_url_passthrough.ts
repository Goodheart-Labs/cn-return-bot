/**
 * Test: Can we trigger urlContext by returning URLs in a tool response?
 * Idea: model calls gemini_web_fetch(urls), we echo the URLs back as text,
 * urlContext picks them up and fetches them server-side on the next turn.
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-3-flash-preview";

const TEST_URL = "https://forum.effectivealtruism.org/posts/ychu2LAw54sNcocKH/the-anthropic-ipo-is-coming-we-aren-t-ready-for-it";

async function main() {
  const tools = [
    { urlContext: {} },
    { googleSearch: {} },
    {
      functionDeclarations: [
        {
          name: "gemini_web_fetch",
          description: "Request URL fetches. Returns the URLs for verification.",
          parameters: {
            type: "OBJECT",
            properties: {
              urls: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "URLs to fetch and verify",
              },
            },
            required: ["urls"],
          },
        },
        {
          name: "submit_answer",
          description: "Submit your final answer with source",
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
Then call gemini_web_fetch to verify the source URL. After verification, call submit_answer.`,
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

    // Log urlContext
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
      else if (p.functionCall) {
        console.log(`  functionCall: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args)})`);
      }
      else if (p.thoughtSignature) { /* skip */ }
      else console.log(`  other:`, JSON.stringify(p).slice(0, 150));
    }

    const functionCalls = parts.filter((p: any) => p.functionCall);
    if (functionCalls.length === 0) {
      console.log("  (no function calls — done)");
      break;
    }

    contents.push({ role: "model", parts });

    const responseParts: any[] = [];
    for (const fc of functionCalls) {
      const name = fc.functionCall.name;
      const args = fc.functionCall.args;

      if (name === "gemini_web_fetch") {
        const urls = args.urls as string[];
        console.log(`  -> gemini_web_fetch called with: ${urls.join(", ")}`);
        // Echo URLs back as text so urlContext can pick them up
        const responseText = urls.map((u: string) => `Verify this source: ${u}`).join("\n");
        responseParts.push({
          functionResponse: {
            name,
            response: { message: responseText },
            id: fc.functionCall.id,
          },
        });
      } else if (name === "submit_answer") {
        console.log(`  -> FINAL ANSWER:`);
        console.log(`     source_url: ${args.source_url}`);
        console.log(`     answer: ${args.answer?.slice(0, 200)}`);
        return;
      }
    }

    contents.push({ role: "user", parts: responseParts });
  }
}

main().catch(console.error);
