// End-to-end test of Common Notes auth + gated voting + AI improve-note judge.
import { createClient } from "@supabase/supabase-js";

const URL = "http://127.0.0.1:54321";
const ANON = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE = process.env.SUPABASE_SECRET_KEY ?? (() => { throw new Error("set SUPABASE_SECRET_KEY (local sb_secret_… from `supabase status`)"); })();
const NOTE_ID = process.argv[2]!;

const admin = createClient(URL, SERVICE);
const anon = createClient(URL, ANON);

function log(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

// 1. Anonymous vote must be rejected by RLS/grants.
{
  const { error } = await anon.from("everything_votes").insert({ note_id: NOTE_ID, voter_id: crypto.randomUUID(), vote: 1 });
  log("anon vote rejected", !!error, error?.message ?? "UNEXPECTEDLY SUCCEEDED");
}

// 2. Create + sign in a test user.
const email = `tester+${Date.now().toString(36)}@example.com`;
const password = "password123";
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
log("test user signed in", !!signIn.session, signInErr?.message ?? signIn.user?.id);
const token = signIn.session!.access_token;
const userId = signIn.user!.id;
const user = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });

// 3. Authenticated vote succeeds and bumps the counter.
{
  const before = (await admin.from("everything_notes").select("helpful_count").eq("id", NOTE_ID).single()).data!.helpful_count;
  const { error } = await user.from("everything_votes").upsert({ note_id: NOTE_ID, voter_id: userId, vote: 1 }, { onConflict: "note_id,voter_id" });
  const after = (await admin.from("everything_notes").select("helpful_count").eq("id", NOTE_ID).single()).data!.helpful_count;
  log("authed vote + counter", !error && after === before + 1, error?.message ?? `helpful ${before}→${after}`);
}

// 4. A user can read only their own vote (RLS).
{
  const mine = (await user.from("everything_votes").select("*")).data ?? [];
  log("reads only own vote", mine.length === 1 && mine[0].voter_id === userId, `${mine.length} row(s)`);
}

// 5. Improve-note judge: earnest suggestion → accepted.
async function judge(text: string) {
  const { data, error } = await user.functions.invoke("judge-suggestion", { body: { note_id: NOTE_ID, suggested_text: text } });
  if (error) {
    const detail = await (error as any).context?.json?.().catch(() => null);
    return { error: detail?.error ?? error.message };
  }
  return data as { status: string; reason: string };
}
{
  const r = await judge("Pier Luigi Farnese was made Captain General in 1537; the note is correct but would be stronger stating that date explicitly and noting he was later made Duke of Parma in 1545.");
  log("earnest suggestion accepted", (r as any).status === "accepted", (r as any).reason ?? (r as any).error);
}
{
  const r = await judge("lol this is dumb you are all idiots ratioed");
  log("trolling suggestion rejected", (r as any).status === "rejected", (r as any).reason ?? (r as any).error);
}

// 6. Anonymous invoke of the judge is rejected. Use a FRESH anon client — the one
// above was signed in, so it now carries a session.
{
  const freshAnon = createClient(URL, ANON);
  const { error } = await freshAnon.functions.invoke("judge-suggestion", { body: { note_id: NOTE_ID, suggested_text: "x".repeat(20) } });
  log("anon judge rejected", !!error, error ? "blocked (401)" : "UNEXPECTEDLY SUCCEEDED");
}

// Cleanup this test user (cascades votes + suggestions).
await admin.auth.admin.deleteUser(userId);
console.log("cleaned up test user");
