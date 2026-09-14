// Replays the whole note-needed prefilter, with the exact user messages recent
// production runs used, four at a time like the services machine, for
// PROBE_MINUTES. Every OpenRouter call is timed and its provider, finish reason
// and content length recorded, to catch a slow empty answer in the act.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import { runNoteNeededPrefilter } from "../../pipeline/prefilter/noteNeededPrefilter";

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
const DURATION_MS = Number(process.env.PROBE_MINUTES ?? 30) * 60_000;
const CONCURRENCY = 4;
const stamp = () => new Date().toISOString().slice(11, 19);
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (!url.includes("openrouter.ai")) return realFetch(input, init);
  const n = ++calls, started = Date.now();
  const body = init?.body ? JSON.parse(init.body) : null;
  const step = body?.messages?.[0]?.content?.slice(0, 40).replace(/\n/g, " ");
  const res = await realFetch(input, init);
  const tHeaders = Date.now() - started;
  const text = await res.text();
  const tEnd = Date.now() - started;
  let line = `${stamp()} call#${n} model=${body?.model} headers=${(tHeaders / 1000).toFixed(1)}s end=${(tEnd / 1000).toFixed(1)}s status=${res.status}`;
  try { const j = JSON.parse(text); const c = j.choices?.[0]; const len = (c?.message?.content ?? "").length;
    line += ` provider=${j.provider} finish=${c?.finish_reason} content=${len} reasoning=${j.usage?.completion_tokens_details?.reasoning_tokens} completion=${j.usage?.completion_tokens}${len === 0 ? " <== EMPTY" : ""}`;
  } catch { line += ` body-not-json: ${text.slice(0, 120)}`; }
  if (tEnd > 120_000) line += " <== SLOW";
  console.log(`${line} | ${step}`);
  return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
}) as any;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await db.from("pipeline_runs").select("tweet_id, logs").gte("created_at", "2026-09-13T00:00:00Z").eq("outcome", "rejected").not("logs", "is", null).order("created_at", { ascending: false }).limit(60);
if (error) throw error;
const messages = data!.map((r) => ({ id: r.tweet_id, msg: r.logs?.note_prefilter_steps?.satire_detector?.messages?.["0"]?.userMessage as string | undefined })).filter((m) => m.msg);
console.log(`${stamp()} ${messages.length} production prompts loaded`);
const t0 = Date.now(); let next = 0;
async function worker(w: number) {
  while (Date.now() - t0 < DURATION_MS) {
    const m = messages[next++ % messages.length]!;
    const started = Date.now();
    try {
      const v = await withTweetLog(createTweetLog(), () => withCostTracker(() => runNoteNeededPrefilter(m.msg!)));
      console.log(`${stamp()} [w${w}] tweet ${m.id} done in ${((Date.now() - started) / 1000).toFixed(0)}s: needsNote=${v.needsNote}`);
    } catch (e: any) { console.log(`${stamp()} [w${w}] tweet ${m.id} threw after ${((Date.now() - started) / 1000).toFixed(0)}s: ${e.message?.slice(0, 200)}`); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)));
console.log(`${stamp()} replay probe done, ${calls} OpenRouter calls`);
