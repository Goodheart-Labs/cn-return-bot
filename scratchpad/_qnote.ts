import "dotenv/config";
import { getSupabaseClient } from "../src/api/supabaseClient";
const db = getSupabaseClient();
const { data: claims } = await db.from("everything_claims").select("id, claim").ilike("claim", "%doubling times measured in minutes%");
for (const c of claims ?? []) {
  const { data: notes } = await db.from("everything_notes").select("note, sources").eq("claim_id", c.id);
  for (const n of notes ?? []) {
    console.log("CLAIM:", c.claim);
    console.log("NOTE:", n.note);
    console.log("SOURCES (", (n.sources??[]).length, "):");
    for (const s of n.sources ?? []) console.log("   -", s);
  }
}
