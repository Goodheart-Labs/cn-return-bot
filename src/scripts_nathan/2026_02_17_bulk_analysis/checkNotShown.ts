import { getSupabaseClient } from "../../api/supabaseClient";

async function main() {
  const client = getSupabaseClient();

  // Get notes with NOT_SHOWN_ON_X status
  const { data: notShownSnapshots } = await client
    .from("scraped_notewriter_snapshots")
    .select("note_id, cn_status, view_count, scraped_at")
    .eq("cn_status", "NOT_SHOWN_ON_X");

  console.log("Notes with NOT_SHOWN_ON_X status:", notShownSnapshots?.length);

  // Get the note_ids
  const noteIds = [...new Set(notShownSnapshots?.map(s => s.note_id) || [])];
  console.log("Unique note_ids:", noteIds.length);

  // Check if any are bot-submitted
  const { data: botNotes } = await client
    .from("notes")
    .select("note_id, bot_name")
    .in("note_id", noteIds);

  console.log("\nBot-submitted notes with NOT_SHOWN_ON_X:");
  if (botNotes && botNotes.length > 0) {
    for (const n of botNotes) {
      console.log(`  ${n.note_id} - ${n.bot_name}`);
    }
  } else {
    console.log("  None");
  }

  // Get the scraped note text for NOT_SHOWN notes
  const { data: scrapedNotes } = await client
    .from("canonical_note_information")
    .select("note_id, note_text")
    .in("note_id", noteIds);

  console.log("\nNOT_SHOWN_ON_X notes text samples:");
  for (const n of (scrapedNotes || []).slice(0, 3)) {
    console.log(`\n  ${n.note_id}:`);
    console.log(`  "${n.note_text?.slice(0, 100)}..."`);
  }
}

main().catch(console.error);
