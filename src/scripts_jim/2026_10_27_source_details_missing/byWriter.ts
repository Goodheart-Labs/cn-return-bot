import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/** Splits AI notes since SINCE by which writer made them and whether any source has a quote.
 *  A note is the pipeline's when its claim has a "check" row in everything_pipeline_runs. */
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-10-20";

const { data: notes, error } = await db
  .from("everything_notes")
  .select("id, claim_id, created_at, author_id, everything_note_sources(quote)")
  .gte("created_at", SINCE)
  .is("author_id", null)
  .limit(1000);
if (error) throw error;

const claimIds = [...new Set(notes.map((n) => n.claim_id))];
const checked = new Set<string>();
for (let i = 0; i < claimIds.length; i += 150) {
  const { data, error: e } = await db.from("everything_pipeline_runs").select("claim_id").eq("kind", "check").in("claim_id", claimIds.slice(i, i + 150));
  if (e) throw e;
  for (const r of data) checked.add(r.claim_id);
}

const counts = new Map<string, number>();
for (const n of notes) {
  const writer = checked.has(n.claim_id) ? "pipeline" : "other";
  const quotes = n.everything_note_sources.some((s) => s.quote) ? "quotes" : "no quotes";
  const key = `${n.created_at.slice(0, 10)} ${writer} ${quotes}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
console.log(`AI notes since ${SINCE}: ${notes.length}`);
for (const [k, v] of [...counts].sort()) console.log(k, v);
