/**
 * Survey: N identical query-writer calls on one tweet, tabulating
 * provider vs reasoning_tokens vs query count — to test whether the
 * empty-queries flip correlates with which provider OpenRouter routes to.
 *
 * Usage: bun run src/scripts_jim/2026_07_02_query_writer_empty/surveyProviders.ts <tweet-id> [n]
 */
import OpenAI from "openai";
import { readFileSync } from "fs";
import { QUERY_WRITER_SYSTEM_PROMPT, QUERY_WRITER_RESPONSE_FORMAT } from "../../pipeline/prompts/cheap-bot/queryWriter";
import { stripJsonFences } from "../../pipeline/utils/jsonOutput";

const MODEL = "deepseek/deepseek-v4-flash";
const tweetId = process.argv[2];
const n = Number(process.argv[3] ?? 12);

const cases = JSON.parse(readFileSync(new URL("./missed_opps.json", import.meta.url), "utf8"));
const c = cases.find((x: any) => x.tweet_id === tweetId);
if (!c) {
  console.error(`tweet ${tweetId} not in missed_opps.json`);
  process.exit(1);
}

const client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY });

console.log("attempt | provider | reasoning_tokens | finish | queries");
for (let i = 1; i <= n; i++) {
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

  const r: any = response;
  let count: number | string = "parse-error";
  try {
    count = (JSON.parse(stripJsonFences(r.choices?.[0]?.message?.content ?? "{}")).queries ?? []).length;
  } catch {}
  console.log(
    `${i} | ${r.provider} | ${r.usage?.completion_tokens_details?.reasoning_tokens ?? "?"} | ${r.choices?.[0]?.finish_reason} | ${count}`,
  );
}
