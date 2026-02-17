import { getSupabaseClient } from "../api/supabaseClient";

async function main() {
  const client = getSupabaseClient();

  // Search for Tony Romo note in scraped_notewriter_notes
  const { data: scrapedNotes } = await client
    .from("scraped_notewriter_notes")
    .select("*")
    .ilike("note_text", "%Tony Romo%");
  console.log("Tony Romo in scraped_notewriter_notes:", scrapedNotes?.length || 0);
  if (scrapedNotes?.length) console.log(scrapedNotes);

  // Search in notes table
  const { data: botNotes } = await client
    .from("notes")
    .select("*")
    .ilike("note_text", "%Tony Romo%");
  console.log("\nTony Romo in notes table:", botNotes?.length || 0);
  if (botNotes?.length) console.log(botNotes);

  // Search for "Bills victory" in case text is slightly different
  const { data: billsNotes } = await client
    .from("scraped_notewriter_notes")
    .select("*")
    .ilike("note_text", "%Bills victory%");
  console.log("\nBills victory in scraped_notewriter_notes:", billsNotes?.length || 0);
  if (billsNotes?.length) console.log(billsNotes);

  // Also search notes table
  const { data: billsBotNotes } = await client
    .from("notes")
    .select("*")
    .ilike("note_text", "%Bills victory%");
  console.log("\nBills victory in notes table:", billsBotNotes?.length || 0);
  if (billsBotNotes?.length) console.log(billsBotNotes);
}

main().catch(console.error);
