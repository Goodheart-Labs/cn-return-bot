/**
 * Test: After googleSearch, does Gemini know the REAL URLs to pass to web_fetch?
 * Simulates the pipeline: search -> find URL -> call web_fetch(url) -> verify content.
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-3-flash-preview";

async function main() {
  const tools = [
    { googleSearch: {} },
    {
      functionDeclarations: [{
        name: "web_fetch",
        description: "Fetch a URL and extract its text content.",
        parameters: {
          type: "OBJECT",
          properties: { url: { type: "STRING", description: "The URL to fetch" } },
          required: ["url"],
        },
      }, {
        name: "submit_answer",
        description: "Submit your final verified answer",
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

  const contents: any[] = [{
    role: "user",
    parts: [{
      text: `Search for the EA Forum article "The Anthropic IPO Is Coming. We Aren't Ready for It."
Then call web_fetch on the article URL to verify its contents. Finally call submit_answer.`,
    }],
  }];

  for (let turn = 1; turn <= 5; turn++) {
    console.log(`\n--- Turn ${turn} ---`);
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

    // Log what the model did
    for (const p of parts) {
      if (p.text) console.log(`  text: ${p.text.slice(0, 200)}`);
      else if (p.functionCall) {
        console.log(`  functionCall: ${p.functionCall.name}`);
        console.log(`    args: ${JSON.stringify(p.functionCall.args)}`);
      }
      else if (p.thoughtSignature) { /* skip */ }
      else console.log(`  other:`, JSON.stringify(p).slice(0, 200));
    }

    if (c?.groundingMetadata?.groundingChunks?.length) {
      console.log("  groundingChunks URLs:");
      for (const chunk of c.groundingMetadata.groundingChunks) {
        if (chunk.web) console.log(`    ${chunk.web.title}: ${chunk.web.uri?.slice(0, 100)}`);
      }
    }

    // Find function calls
    const functionCalls = parts.filter((p: any) => p.functionCall);
    if (functionCalls.length === 0) {
      console.log("  (no function calls — done)");
      break;
    }

    // Push model response
    contents.push({ role: "model", parts });

    // Handle each function call
    const responseParts: any[] = [];
    for (const fc of functionCalls) {
      const name = fc.functionCall.name;
      const args = fc.functionCall.args;

      if (name === "web_fetch") {
        console.log(`  -> web_fetch called with URL: ${args.url}`);
        responseParts.push({
          functionResponse: {
            name,
            response: { content: `[Simulated content from ${args.url}] This is the article about Anthropic IPO and EA grantmaking infrastructure.` },
            id: fc.functionCall.id,
          },
        });
      } else if (name === "submit_answer") {
        console.log(`  -> FINAL ANSWER:`);
        console.log(`     source_url: ${args.source_url}`);
        console.log(`     answer: ${args.answer?.slice(0, 200)}`);
        responseParts.push({
          functionResponse: { name, response: { status: "ok" }, id: fc.functionCall.id },
        });
        return; // Done
      }
    }

    contents.push({ role: "user", parts: responseParts });
  }
}

main().catch(console.error);
