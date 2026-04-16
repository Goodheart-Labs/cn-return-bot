/**
 * Full loop test: model calls gemini_web_fetch -> we inject URLs as user message
 * -> urlContext fetches them -> model sees the content and submits answer.
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-3-flash-preview";

async function main() {
  const tools = [
    { urlContext: {} },
    {
      functionDeclarations: [
        {
          name: "gemini_web_fetch",
          description: "Fetch URLs for source verification. Call this before citing any source.",
          parameters: {
            type: "OBJECT",
            properties: {
              urls: { type: "ARRAY", items: { type: "STRING" }, description: "URLs to fetch and verify" },
            },
            required: ["urls"],
          },
        },
        {
          name: "submit_answer",
          description: "Submit your verified answer",
          parameters: {
            type: "OBJECT",
            properties: {
              answer: { type: "STRING" },
              sources: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["answer", "sources"],
          },
        },
      ],
    },
  ];

  const contents: any[] = [{
    role: "user",
    parts: [{
      text: `I need you to verify content from specific URLs.
Call gemini_web_fetch with these URLs:
- https://forum.effectivealtruism.org/posts/ychu2LAw54sNcocKH/the-anthropic-ipo-is-coming-we-aren-t-ready-for-it
- https://en.wikipedia.org/wiki/Anthropic
After reading the fetched content, call submit_answer with a summary and the source URLs.`,
    }],
  }];

  for (let turn = 1; turn <= 8; turn++) {
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
      if (p.text) console.log(`  text: ${p.text.slice(0, 250)}`);
      else if (p.functionCall) console.log(`  functionCall: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, 200)})`);
      else if (p.thoughtSignature) { /* skip */ }
    }

    const functionCalls = parts.filter((p: any) => p.functionCall);
    if (functionCalls.length === 0) {
      console.log("  (no function calls — done)");
      break;
    }

    contents.push({ role: "model", parts });

    for (const fc of functionCalls) {
      if (fc.functionCall.name === "gemini_web_fetch") {
        const urls = fc.functionCall.args.urls as string[];
        console.log(`  -> Injecting ${urls.length} URL(s) as user message for urlContext`);

        // Tool response to satisfy the function call contract
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: "gemini_web_fetch",
              response: { status: "URLs injected for fetching. Read the fetched content from the context." },
              id: fc.functionCall.id,
            },
          }],
        });

        // User message with URLs for urlContext to pick up
        contents.push({
          role: "user",
          parts: [{ text: `[Source verification] Please read and verify these URLs:\n${urls.join("\n")}` }],
        });
      } else if (fc.functionCall.name === "submit_answer") {
        console.log(`\n  FINAL ANSWER:`);
        console.log(`  sources: ${JSON.stringify(fc.functionCall.args.sources)}`);
        console.log(`  answer: ${fc.functionCall.args.answer?.slice(0, 300)}`);
        return;
      }
    }
  }
}

main().catch(console.error);
