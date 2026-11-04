import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: notes, error } = await db
  .from("everything_notes")
  .select("id, created_at, author_id, note, claim_id, everything_note_sources(url, quote, explanation, sort_order)")
  .ilike("note", "%Torvosaurus%");
if (error) throw error;
console.log(JSON.stringify(notes, null, 2));
for (const n of notes ?? []) {
  const { data: runs } = await db.from("everything_pipeline_runs").select("id, kind, created_at, outcome:logs->outcome").eq("claim_id", n.claim_id);
  console.log(n.id, JSON.stringify(runs)?.slice(0, 600));
}
