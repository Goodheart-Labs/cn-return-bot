// Reproduces one prefilter step on the tweets that stalled on the box, timing
// the OpenRouter call: when the headers arrive, when the body ends, and what
// the body says (provider, finish_reason, usage).
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { withBotConfig, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import { runSatireDetector } from "../../pipeline/prefilter/satireDetector";
import { runQueryWriter } from "../../pipeline/prefilter/queryWriter";

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (!url.includes("openrouter.ai")) return realFetch(input, init);
  const started = Date.now();
  const body = init?.body ? JSON.parse(init.body) : null;
  console.log(`${stamp()} → request model=${body?.model} reasoning=${JSON.stringify(body?.reasoning ?? body?.reasoning_effort)} max_tokens=${body?.max_tokens} stream=${body?.stream}`);
  const res = await realFetch(input, init);
  console.log(`${stamp()} ← headers after ${((Date.now() - started) / 1000).toFixed(1)}s status=${res.status}`);
  const text = await res.text();
  console.log(`${stamp()} ← body after ${((Date.now() - started) / 1000).toFixed(1)}s, ${text.length} chars, leading whitespace ${text.length - text.trimStart().length}`);
  try {
    const j = JSON.parse(text);
    const c = j.choices?.[0];
    console.log(`   provider=${j.provider} finish=${c?.finish_reason} native_finish=${c?.native_finish_reason} content_len=${(c?.message?.content ?? "").length} reasoning_len=${(c?.message?.reasoning ?? "").length} usage=${JSON.stringify(j.usage)}`);
  } catch { console.log("   body not JSON:", text.slice(0, 200)); }
  return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
}) as any;

const DEEPSEEK = "deepseek/deepseek-v4-flash";
const PREFILTER_CONFIG: BotConfig = {
  botId: "note-needed-prefilter", model: DEEPSEEK, search_model: DEEPSEEK, search_analyzer_model: DEEPSEEK,
  note_judge_model: DEEPSEEK, web_search: "serper", video_description_strategy: "frames",
  parallel_research: false, reasoning_effort: "high", temperature: 0,
};

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const REPEAT = Number(process.env.REPEAT ?? 1); const ids = process.argv.slice(2);
const { data, error } = await db.from("tweets").select("tweet_id, text").in("tweet_id", ids);
if (error) throw error;
await Promise.all(data!.flatMap((t) => Array.from({ length: REPEAT }, (_, i) => ({ ...t, tweet_id: `${t.tweet_id}#${i}` }))).map(async (t) => {
  const log = createTweetLog();
  await withTweetLog(log, () => withBotConfig(PREFILTER_CONFIG, () => withCostTracker(async () => {
    console.log(`${stamp()} [${t.tweet_id}] satire detector start; text: ${t.text.slice(0, 80).replace(/\n/g, " ")}`);
    try { const q = await runQueryWriter(t.text); console.log(`${stamp()} [${t.tweet_id}] queries: ${JSON.stringify(q).slice(0, 200)}`); } catch (e: any) { console.log(`${stamp()} [${t.tweet_id}] query writer threw: ${e.message}`); }
  })));
}));
console.log(`${stamp()} done`);
