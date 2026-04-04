import "dotenv/config";
import { SupabaseLogger } from "../../api/supabaseClient";

const supabase = new SupabaseLogger();

// Check canonical_note_information table
const { data: notes, error: notesError } = await (supabase as any).client
  .from("canonical_note_information")
  .select("note_id, tweet_id")
  .order("created_at", { ascending: false })
  .limit(20);

if (notesError) {
  console.error("Error fetching notes:", notesError);
} else {
  console.log("Recent canonical_note_information:");
  notes?.forEach((d: any) => console.log("  ", d.note_id, "→", d.tweet_id));
  console.log("Total shown:", notes?.length);
}

// Check a specific note that should have been imported
const testNoteId = "2003320051907117068";
const exists = await supabase.scrapedNotewriterNoteExists(testNoteId);
console.log(`\nDoes note ${testNoteId} exist?`, exists);

// Try to insert a test note
console.log("\nTrying to insert a test note...");
try {
  await supabase.upsertScrapedNotewriterNote({
    note_id: "test_" + Date.now(),
    tweet_id: "1234567890123456789",
    note_text: "Test note text",
  });
  console.log("Insert succeeded!");
} catch (err) {
  console.error("Insert failed:", err);
}
