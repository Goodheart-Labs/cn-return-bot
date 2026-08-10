// @ts-nocheck
// This file is a Deno edge function. It uses Deno globals and imports from
// esm.sh, and those only resolve on Supabase's Deno runtime once the function is
// deployed. The repo's Node tsc cannot check them, which is why checking is
// turned off above.
//
// judge-note guards both of the flows in which a signed-in user writes a note on
// Common Notes. Those flows are writing a new note and suggesting an improvement
// to an existing one. Both of them post an ordinary draft note. An LLM decides
// whether the submitted text is spam. The client only inserts the note when this
// function answers "accepted". Doing the check here keeps the OpenRouter key out
// of the browser. Anonymous callers are turned away before we spend anything on
// the LLM. The function itself writes nothing to the database.
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

async function isSpam(context: string, currentNote: string, proposal: string): Promise<boolean> {
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
            "Is this spam? Judge only whether it is spam, an ad, or gibberish — not whether it is correct or well-argued. When unsure, spam=false. Reply with JSON: {\"spam\": boolean}.",
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
  // We only need the boolean, so we read it straight out of the raw text with a
  // regex. JSON.parse would throw on the shapes a model sometimes returns, such
  // as code fences around the object, prose after it, or the object twice.
  const content: string = data.choices?.[0]?.message?.content ?? "";
  const match = content.match(/"spam"\s*:\s*(true|false)/i);
  if (!match) throw new Error(`no spam verdict in model output: ${content.slice(0, 120)}`);
  return match[1].toLowerCase() === "true";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Check that the caller is a signed-in user. Holding the anon key on its own
  // is not enough.
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

  let spam: boolean;
  try {
    spam = await isSpam(context, currentNote, note);
  } catch (err) {
    return json({ error: `Judge failed: ${(err as Error).message}` }, 502);
  }

  return json({ status: spam ? "rejected" : "accepted" });
});
