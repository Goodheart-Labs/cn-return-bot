// Fires the production query-writer request at OpenRouter every 20 seconds for
// an hour, once without streaming (exactly as production) and once streaming,
// and records per call: provider, time to headers, time to first token, time to
// end, finish reason, token usage. The point is to catch one of the 30-minute
// empty answers the services machine sees and learn which provider serves it
// and whether tokens trickle during the wait (runaway reasoning) or nothing
// arrives at all (a provider queue).
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { withBotConfig, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import { runQueryWriter } from "../../pipeline/prefilter/queryWriter";

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
const DURATION_MS = Number(process.env.PROBE_MINUTES ?? 60) * 60_000;
const INTERVAL_MS = 20_000;
const CALL_CAP_MS = 55 * 60_000;
const t0 = Date.now();
const stamp = () => new Date().toISOString().slice(11, 19);

// Capture the exact request body production sends.
let captured: { url: string; headers: any; body: string } | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (url.includes("openrouter.ai") && !captured) captured = { url, headers: init?.headers, body: init!.body };
  return realFetch(input, init);
}) as any;
const DEEPSEEK = "deepseek/deepseek-v4-flash";
const cfg: BotConfig = { botId: "note-needed-prefilter", model: DEEPSEEK, search_model: DEEPSEEK, search_analyzer_model: DEEPSEEK, note_judge_model: DEEPSEEK, web_search: "serper", video_description_strategy: "frames", parallel_research: false, reasoning_effort: "high", temperature: 0 };
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data } = await db.from("tweets").select("text").eq("tweet_id", process.argv[2] ?? "2099147989080285235").single();
await withTweetLog(createTweetLog(), () => withBotConfig(cfg, () => withCostTracker(() => runQueryWriter(data!.text))));
if (!captured) throw new Error("no request captured");
globalThis.fetch = realFetch;
const headers = { ...Object.fromEntries(new Headers(captured.headers as any).entries()) };
console.log(`${stamp()} captured body: ${captured.body.slice(0, 300)}...`);

async function once(stream: boolean, n: number) {
  const started = Date.now();
  const tag = `#${n} ${stream ? "stream" : "plain "}`;
  try {
    const res = await realFetch(captured!.url, { method: "POST", headers, body: stream ? JSON.stringify({ ...JSON.parse(captured!.body), stream: true }) : captured!.body, signal: AbortSignal.timeout(CALL_CAP_MS) });
    const tHeaders = Date.now() - started;
    let text = "", firstByte = 0, firstToken = 0, chunks = 0;
    const reader = res.body!.getReader(); const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      const piece = dec.decode(value, { stream: true }); text += piece; chunks++;
      if (!firstByte) firstByte = Date.now() - started;
      if (!firstToken && /"(content|reasoning)":"[^"]/.test(piece)) firstToken = Date.now() - started;
    }
    const tEnd = Date.now() - started;
    let provider = "?", finish = "?", usage = "?", contentLen = -1, reasoningLen = -1;
    if (stream) {
      const events = text.split("\n").filter((l) => l.startsWith("data: ") && !l.includes("[DONE]")).map((l) => JSON.parse(l.slice(6)));
      provider = events.find((e) => e.provider)?.provider ?? "?";
      finish = events.map((e) => e.choices?.[0]?.finish_reason).filter(Boolean).pop() ?? "?";
      const last = events.find((e) => e.usage); usage = last ? JSON.stringify(last.usage.completion_tokens_details ?? last.usage) : "?";
      contentLen = events.reduce((a, e) => a + (e.choices?.[0]?.delta?.content ?? "").length, 0);
      reasoningLen = events.reduce((a, e) => a + (e.choices?.[0]?.delta?.reasoning ?? "").length, 0);
    } else {
      const j = JSON.parse(text); const c = j.choices?.[0];
      provider = j.provider; finish = c?.finish_reason; usage = JSON.stringify({ completion: j.usage?.completion_tokens, reasoning: j.usage?.completion_tokens_details?.reasoning_tokens });
      contentLen = (c?.message?.content ?? "").length; reasoningLen = (c?.message?.reasoning ?? "").length;
    }
    console.log(`${stamp()} ${tag} status=${res.status} headers=${(tHeaders / 1000).toFixed(1)}s firstByte=${(firstByte / 1000).toFixed(1)}s firstToken=${(firstToken / 1000).toFixed(1)}s end=${(tEnd / 1000).toFixed(1)}s chunks=${chunks} provider=${provider} finish=${finish} content=${contentLen} reasoning=${reasoningLen} usage=${usage}${contentLen === 0 ? "  <== EMPTY" : ""}${tEnd > 120_000 ? "  <== SLOW" : ""}`);
  } catch (e: any) {
    console.log(`${stamp()} ${tag} threw after ${((Date.now() - started) / 1000).toFixed(1)}s: ${e.message}`);
  }
}
const pending: Promise<void>[] = [];
for (let n = 1; Date.now() - t0 < DURATION_MS; n++) {
  pending.push(once(false, n), once(true, n));
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
await Promise.all(pending);
console.log(`${stamp()} probe done`);
