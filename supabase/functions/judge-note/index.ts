// @ts-nocheck — Deno edge function (Deno globals + esm.sh imports); types resolve
// at deploy on Supabase's Deno runtime, not under the repo's Node tsc.
// judge-note: gates BOTH flows where a signed-in user writes a note on Common
// Notes — writing a new note and suggesting an improvement (both post an
// ordinary draft note). An LLM decides earnest good-faith vs trolling; only
// earnest notes are posted (the client inserts on an "accepted" verdict). Runs
// server-side so the OpenRouter key never touches the browser, and rejects
// anonymous callers before any LLM cost is incurred. It writes nothing itself.
//
// Local:  supabase functions serve judge-note --env-file .env
// Deploy: supabase functions deploy judge-note  (then: supabase secrets set OPENROUTER_API_KEY=...)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const JUDGE_MODEL = "anthropic/claude-haiku-4.5";
const MAX_NOTE_CHARS = 1500;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function isEarnest(context: string, currentNote: string, proposal: string): Promise<boolean> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "A user wrote a community note fact-checking or adding context to a claim. Your ONLY job is to decide whether it's a sincere, good-faith note versus trolling. It does NOT need to be correct, complete, or well-written — sincerity is the bar. earnest=true for any genuine on-topic note (a correction, added context, a source, a disagreement, a question). earnest=false only for clear bad faith: insults, spam, jokes, gibberish, vandalism, or text unrelated to the claim's topic. When unsure, lean earnest. Reply with JSON: {\"earnest\": boolean}.",
        },
        {
          role: "user",
          content: `Claim / context being noted: ${context}` +
            (currentNote ? `\nExisting note being improved: ${currentNote}` : "") +
            `\nProposed note: ${proposal}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // We only need the boolean, so pull it out directly — robust to code fences,
  // trailing prose, or duplicated objects that break strict JSON.parse.
  const content: string = data.choices?.[0]?.message?.content ?? "";
  const match = content.match(/"earnest"\s*:\s*(true|false)/i);
  if (!match) throw new Error(`no earnest verdict in model output: ${content.slice(0, 120)}`);
  return match[1].toLowerCase() === "true";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Verify the caller is a logged-in user (not the bare anon key).
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData } = await asUser.auth.getUser();
  if (!userData?.user) return json({ error: "Sign in to write a note" }, 401);

  const body = await req.json().catch(() => ({}));
  const note = String(body.note ?? "").trim();
  const context = String(body.context ?? "").trim();
  const currentNote = String(body.current_note ?? "").trim();
  if (!note) return json({ error: "note required" }, 400);
  if (note.length > MAX_NOTE_CHARS) return json({ error: "Note too long" }, 400);

  let earnest: boolean;
  try {
    earnest = await isEarnest(context, currentNote, note);
  } catch (err) {
    return json({ error: `Judge failed: ${(err as Error).message}` }, 502);
  }

  return json({ status: earnest ? "accepted" : "rejected" });
});
