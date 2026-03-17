import { getSupabaseClient } from "../api/supabaseClient";

async function main() {
  const client = getSupabaseClient();

  const noteId = "2012858409716998482";

  // Check snapshots for this note
  const { data: snapshots } = await client
    .from("scraped_notewriter_snapshots")
    .select("*")
    .eq("note_id", noteId);

  console.log(`Snapshots for note ${noteId}:`);
  console.log(JSON.stringify(snapshots, null, 2));
}

main().catch(console.error);
