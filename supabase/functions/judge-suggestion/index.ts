// @ts-nocheck — Deno edge function (Deno globals + esm.sh imports); types resolve
// at deploy on Supabase's Deno runtime, not under the repo's Node tsc.
// judge-suggestion: a logged-in user proposes a better version of a note; an LLM
// decides whether the proposal is an earnest good-faith improvement or trolling.
// Earnest proposals are stored as 'accepted' and shown publicly; the rest are
// 'rejected'. Runs server-side so the OpenRouter key and the accept decision
// never touch the browser.
//
// Local:  supabase functions serve judge-suggestion --env-file .env
// Deploy: supabase functions deploy judge-suggestion  (then: supabase secrets set OPENROUTER_API_KEY=...)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const JUDGE_MODEL = "anthropic/claude-haiku-4.5";
const MAX_SUGGESTION_CHARS = 1500;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface Verdict {
  earnest: boolean;
  reason: string;
}

async function judge(claim: string, context: string, currentNote: string, proposal: string): Promise<Verdict> {
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
            "A user proposed a rewrite of a community note that fact-checks a claim. Your ONLY job is to decide whether the proposal is a sincere, good-faith attempt to improve the note versus trolling. It does NOT need to be correct, complete, or better than the original — sincerity is the bar. Set earnest=true for any genuine on-topic edit (rewording, adding detail or a source, disagreeing, questioning). Set earnest=false only for clear bad faith: insults, spam, jokes, gibberish, vandalism, or text unrelated to the note's topic. When unsure, lean earnest. Reply JSON: {\"earnest\": boolean, \"reason\": string} where reason is one short sentence.",
        },
        {
          role: "user",
          content: `Claim: ${claim}\nContext: ${context}\nCurrent note: ${currentNote}\nProposed note: ${proposal}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // Strip ```json fences some models add despite response_format.
  const raw = (data.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(raw);
  return { earnest: !!parsed.earnest, reason: String(parsed.reason ?? "") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  // Verify the caller is a logged-in user (not the bare anon key).
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await asUser.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Sign in to suggest an improvement" }, 401);

  const { note_id, suggested_text } = await req.json().catch(() => ({}));
  const text = String(suggested_text ?? "").trim();
  if (!note_id || !text) return json({ error: "note_id and suggested_text required" }, 400);
  if (text.length > MAX_SUGGESTION_CHARS) return json({ error: "Suggestion too long" }, 400);

  // Service-role client: read the note's context and write the verdict past RLS.
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: note } = await admin
    .from("everything_notes")
    .select("note, everything_claims(claim, context_quote)")
    .eq("id", note_id)
    .maybeSingle();
  if (!note) return json({ error: "Unknown note" }, 404);
  const claimRow = (note as any).everything_claims;

  let verdict: Verdict;
  try {
    verdict = await judge(claimRow?.claim ?? "", claimRow?.context_quote ?? "", (note as any).note, text);
  } catch (err) {
    return json({ error: `Judge failed: ${(err as Error).message}` }, 502);
  }

  const status = verdict.earnest ? "accepted" : "rejected";
  const { error } = await admin.from("everything_note_suggestions").insert({
    note_id,
    author_id: user.id,
    suggested_text: text,
    status,
    judge_reason: verdict.reason,
  });
  if (error) return json({ error: error.message }, 500);

  return json({ status, reason: verdict.reason });
});
