/**
 * Replay the prefilter query writer on a missed-opportunity case until it
 * returns no queries, then dump the FULL raw OpenRouter response.
 *
 * Uses the exact userMessage from the prod run's logs (missed_opps.json,
 * written by fetch_missed_opps.py) and the same call params as the prefilter
 * (deepseek-v4-flash, reasoning_effort high, temp 0, strict json_schema,
 * require_parameters). Calls the OpenAI client directly — NOT llm.ts's
 * callWithRetry — so empty-content responses are not retried away and we see
 * exactly what the provider sent.
 *
 * Usage: bun run src/scripts_jim/2026_07_02_query_writer_empty/replayQueryWriter.ts <tweet-id> [maxAttempts]
 */
import OpenAI from "openai";
import { readFileSync, writeFileSync } from "fs";
import { QUERY_WRITER_SYSTEM_PROMPT, QUERY_WRITER_RESPONSE_FORMAT } from "../../pipeline/prompts/cheap-bot/queryWriter";
import { stripJsonFences } from "../../pipeline/utils/jsonOutput";

const MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_MAX_ATTEMPTS = 30;

const tweetId = process.argv[2];
const maxAttempts = Number(process.argv[3] ?? DEFAULT_MAX_ATTEMPTS);
if (!tweetId) {
  console.error("usage: bun run replayQueryWriter.ts <tweet-id> [maxAttempts]");
  process.exit(1);
}

const cases = JSON.parse(readFileSync(new URL("./missed_opps.json", import.meta.url), "utf8"));
const c = cases.find((x: any) => x.tweet_id === tweetId);
if (!c) {
  console.error(`tweet ${tweetId} not in missed_opps.json`);
  process.exit(1);
}
console.log(`replaying run ${c.pipeline_run_id} (tweet ${tweetId}, prod attempts=${c.query_writer_attempts})`);

const client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY });

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: QUERY_WRITER_SYSTEM_PROMPT },
      { role: "user", content: c.user_message },
    ],
    response_format: QUERY_WRITER_RESPONSE_FORMAT,
    reasoning_effort: "high",
    temperature: 0,
    provider: { require_parameters: true },
  } as any);

  const content = response.choices?.[0]?.message?.content;
  let queries: string[] | null = null;
  try {
    queries = JSON.parse(stripJsonFences(content ?? "{}")).queries ?? null;
  } catch {
    // leave queries null — unparseable counts as "not a real query list"
  }

  const empty = !queries || queries.length === 0;
  console.log(`attempt ${attempt}: ${empty ? "EMPTY" : queries!.map((q) => JSON.stringify(q)).join(" | ")}`);

  if (empty) {
    const outPath = new URL(`./raw_response_${tweetId}_attempt${attempt}.json`, import.meta.url).pathname;
    writeFileSync(outPath, JSON.stringify(response, null, 2));
    console.log(`\n=== FULL RAW OPENROUTER RESPONSE (attempt ${attempt}) → ${outPath} ===`);
    console.log(JSON.stringify(response, null, 2));
    process.exit(0);
  }
}
console.log(`no empty result in ${maxAttempts} attempts`);
