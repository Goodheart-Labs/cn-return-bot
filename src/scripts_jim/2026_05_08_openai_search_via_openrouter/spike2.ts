/**
 * Narrow down what triggers the 500 in production: long prompt? max_tokens?
 */

import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const MODEL = "openai/gpt-5.4-mini";

const LONG_PROMPT = `You are a research agent for Community Notes fact-checking on X/Twitter.

Your job: investigate whether the post below contains a factual error that would benefit from a community note. Use the web_search tool to find evidence.

## Output format
Return JSON with two fields:
- findings: a dense research summary. Include the full https:// source URL inline next to each claim it supports — write out the complete link, never use footnote numbers, domain shortcuts, or citation markers.
- correction_needed: true only if the post contains a clear factual error supported by direct contradicting evidence.

## When NOT to set correction_needed = true
- Opinions, satire, jokes, hyperbole
- Posts that are factually correct
- When you can't find strong contradicting evidence
- When the "error" is too minor or pedantic

## Sourcing rules
- Tweets and tweet replies from the comments are valid sources and can be included in the findings (include full x.com URL).
- Include what each source says that's relevant.
- If no correction is needed, the findings can be brief — just explain why.

Tweet to fact-check:
"BREAKING: Tokyo's population just hit 8 million. Massive shrinkage!"

Respond with strict JSON only matching: { findings: string, correction_needed: boolean }`;

async function tryWithMaxTokens(maxTokens: number): Promise<void> {
  console.log(`\n=== max_tokens=${maxTokens} ===`);
  try {
    const r = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: LONG_PROMPT }],
      max_tokens: maxTokens,
      tools: [{ type: "web_search_preview" as any } as any],
    } as any);
    const msg = r.choices[0]?.message;
    console.log("OK. Content (200):", msg?.content?.slice(0, 200));
    console.log("Usage:", JSON.stringify(r.usage)?.slice(0, 200));
  } catch (err: any) {
    console.log("FAILED:", err.status, err.message?.slice(0, 200));
    if (err.error) console.log("body:", JSON.stringify(err.error)?.slice(0, 400));
  }
}

async function main(): Promise<void> {
  await tryWithMaxTokens(2000);
  await tryWithMaxTokens(3000);
}

main();
