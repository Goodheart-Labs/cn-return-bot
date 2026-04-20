/**
 * Test: Does urlContext activate when URLs are in a text part within the same
 * user turn as the functionResponse?
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
          description: "Request URL fetches. The system will fetch and return the content.",
          parameters: {
            type: "OBJECT",
            properties: {
              urls: { type: "ARRAY", items: { type: "STRING" }, description: "URLs to fetch" },
            },
            required: ["urls"],
          },
        },
        {
          name: "submit_answer",
          description: "Submit final answer",
          parameters: {
            type: "OBJECT",
            properties: { answer: { type: "STRING" }, source_url: { type: "STRING" } },
            required: ["answer", "source_url"],
          },
        },
      ],
    },
  ];

  const contents: any[] = [{
    role: "user",
    parts: [{ text: `Search for "The Anthropic IPO Is Coming" on the EA Forum. Call gemini_web_fetch to verify the source. Then submit_answer.` }],
  }];

  for (let turn = 1; turn <= 5; turn++) {
    console.log(`\n=== Turn ${turn} ===`);
    const r = await client.models.generateContent({
      model: MODEL,
      contents,
      config: { tools, toolConfig: { includeServerSideToolInvocations: true } },
    });

    const c = r.candidates?.[0];
    const parts = c?.content?.parts ?? [];
    const urlCtx = c?.urlContextMetadata;

    if (urlCtx?.urlMetadata?.length) {
      console.log("  urlContext ACTIVATED:");
      for (const m of urlCtx.urlMetadata) console.log(`    ${m.retrievedUrl} -> ${m.urlRetrievalStatus}`);
    } else {
      console.log("  urlContext: (none)");
    }

    for (const p of parts) {
      if (p.text) console.log(`  text: ${p.text.slice(0, 200)}`);
      else if (p.functionCall) console.log(`  functionCall: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args)})`);
      else if (p.thoughtSignature) { /* skip */ }
    }

    const functionCalls = parts.filter((p: any) => p.functionCall);
    if (functionCalls.length === 0) break;

    contents.push({ role: "model", parts });

    for (const fc of functionCalls) {
      if (fc.functionCall.name === "gemini_web_fetch") {
        const urls = fc.functionCall.args.urls as string[];
        console.log(`  -> Called with: ${urls.join(", ")}`);

        // Single user turn: functionResponse + text part with URLs
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "gemini_web_fetch",
                response: { status: "fetched" },
                id: fc.functionCall.id,
              },
            },
            {
              text: urls.join("\n"),
            },
          ],
        });
      } else if (fc.functionCall.name === "submit_answer") {
        console.log(`  -> ANSWER: ${fc.functionCall.args.answer?.slice(0, 150)}`);
        console.log(`  -> SOURCE: ${fc.functionCall.args.source_url}`);
        return;
      }
    }
  }
}

main().catch(console.error);
