import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data, error: fetchErr } = await client
  .from("scraped_notewriter_notes")
  .select("note_id")
  .like("tweet_id", "unknown_restored_%");

if (fetchErr) throw fetchErr;

const stubs = data?.map(r => r.note_id) || [];
console.log(`Found ${stubs.length} stub rows to delete`);

for (let i = 0; i < stubs.length; i += 50) {
  const batch = stubs.slice(i, i + 50);
  const { error } = await client
    .from("scraped_notewriter_notes")
    .delete()
    .in("note_id", batch);
  if (error) { console.error("Delete error:", error); throw error; }
}

console.log(`Deleted ${stubs.length} stub parent rows. Snapshots remain intact.`);
