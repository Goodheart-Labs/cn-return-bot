import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// Check the People magazine note
const noteId = "2014634605618352439";

// Get the note
const { data: note } = await client.from("notes").select("*").eq("note_id", noteId).single();

console.log("Note record:");
console.log(`  cn_status: "${note?.cn_status}"`);
console.log(`  submitted_at: ${note?.submitted_at}`);

// Get all snapshots for this note
const { data: snapshots } = await client
  .from("scraped_notewriter_snapshots")
  .select("*")
  .eq("note_id", noteId)
  .order("scraped_at", { ascending: false });

console.log(`\nSnapshots for this note: ${snapshots?.length || 0}`);
if (snapshots) {
  for (const snap of snapshots) {
    console.log(`  ${snap.scraped_at}: ${snap.cn_status} (views: ${snap.view_count})`);
  }
}
