/**
 * Probe gpt-5 via OpenRouter with web_search_preview + various max_tokens values.
 * Goal: confirm hypothesis that empty content == finish_reason 'length' caused by
 * reasoning tokens eating the budget.
 */
import OpenAI from "openai";
import { config as dotenvConfig } from "dotenv";
dotenvConfig();

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const SYSTEM = "You research a post and return JSON {findings: string, correction_needed: boolean}.";
const USER = `Tweet: "The Indus Valley civilisation was bigger than Egypt and Mesopotamia combined."
Use web_search to verify. Respond with strict JSON only matching: { findings: string, correction_needed: boolean }`;

async function probe(maxTokens: number) {
  console.log(`\n--- max_tokens=${maxTokens} ---`);
  const t0 = Date.now();
  const res = await client.chat.completions.create({
    model: "openai/gpt-5",
    messages: [{ role: "user", content: `${SYSTEM}\n\n${USER}` }],
    tools: [{ type: "web_search_preview" } as any],
    max_tokens: maxTokens,
  } as any);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const choice = res.choices?.[0];
  const content = choice?.message?.content ?? "";
  const finish = choice?.finish_reason;
  const usage = res.usage as any;
  console.log(`  ${dt}s  finish=${finish}  content.len=${content.length}  usage=${JSON.stringify(usage)}`);
  if (content.length > 0 && content.length < 300) console.log(`  content: ${content}`);
  else if (content.length === 0) console.log(`  (empty content)`);
  else console.log(`  content[0..200]: ${content.slice(0, 200)}`);
}

(async () => {
  for (const n of [4000, 8000, 16000]) {
    try { await probe(n); } catch (e: any) { console.log(`  ERROR: ${e?.status} ${e?.message?.slice(0, 200)}`); }
  }
})();
