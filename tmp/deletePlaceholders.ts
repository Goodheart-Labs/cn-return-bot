import { getSupabaseClient } from "../src/api/supabaseClient";

const supabase = getSupabaseClient();

async function main() {
  // Find placeholders
  const { data: placeholders } = await supabase
    .from("scraped_notewriter_notes")
    .select("note_id, tweet_id")
    .like("note_id", "tweet_%");

  console.log(`Found ${placeholders?.length || 0} placeholder notes:`);
  for (const p of placeholders || []) {
    console.log(`  note_id=${p.note_id}, tweet_id=${p.tweet_id}`);
  }

  if (!placeholders || placeholders.length === 0) return;

  // Delete their snapshots first (FK constraint)
  for (const p of placeholders) {
    const { error: snapErr, count } = await supabase
      .from("scraped_notewriter_snapshots")
      .delete({ count: "exact" })
      .eq("note_id", p.note_id);
    console.log(`  Deleted ${count || 0} snapshots for ${p.note_id}${snapErr ? ` (error: ${snapErr.message})` : ''}`);
  }

  // Delete the notes
  const noteIds = placeholders.map(p => p.note_id);
  const { error, count } = await supabase
    .from("scraped_notewriter_notes")
    .delete({ count: "exact" })
    .in("note_id", noteIds);

  if (error) {
    console.error("Error deleting:", error.message);
  } else {
    console.log(`\nDeleted ${count} placeholder notes.`);
  }
}

main().catch(console.error);
