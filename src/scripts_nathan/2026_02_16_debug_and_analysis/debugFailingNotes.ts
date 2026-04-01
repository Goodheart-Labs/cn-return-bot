import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";

const client = getSupabaseClient();

// Tweet IDs from the scraper output for the first few failing notes
// Looking at the scraper output, these notes were found for specific tweets
// We need to find the tweet_ids from the scraper's collected data
// The modal extracts note_id and we have tweet_id from the cell fingerprint

// From the output, the first few notes were:
// 2013291038249464158 (CURRENTLY_RATED_HELPFUL) - no tweet shown
// Let's check what placeholders might match

// Check if there are placeholders for recent tweets that might have these notes
const { data: recentPlaceholders } = await client
  .from("canonical_note_information")
  .select("note_id, tweet_id, first_seen_at")
  .like("note_id", "tweet_%")
  .order("first_seen_at", { ascending: false })
  .limit(30);

console.log("Recent placeholders (these might be the ones getting matched):");
for (const p of recentPlaceholders || []) {
  console.log(`  ${p.note_id} → tweet ${p.tweet_id} (${p.first_seen_at})`);
}

console.log("\n---\n");

// Check notes that failed in bcc6d9a run
const failingNoteIds = [
  "2013291038249464158",
  "2013281253290574293",
  "2013239323840098365",
  "2011479464396661151",
];

console.log("Checking failing notes from bcc6d9a run:\n");

for (const noteId of failingNoteIds) {
  // Check if note exists
  const { data: note } = await client
    .from("canonical_note_information")
    .select("note_id, tweet_id")
    .eq("note_id", noteId);

  console.log(`Note ${noteId}:`);
  console.log(`  Exists: ${note?.length ? 'YES - tweet ' + note[0]!.tweet_id : 'NO'}`);

  // If note doesn't exist, we need to figure out what tweet it was for
  // The scraper collected these, so we could check the latest snapshots
  const { data: snapshot } = await client
    .from("scraped_notewriter_snapshots")
    .select("note_id, cn_status, scraped_at")
    .eq("note_id", noteId)
    .order("scraped_at", { ascending: false })
    .limit(1);

  console.log(`  Has snapshot: ${snapshot?.length ? 'YES - ' + snapshot[0]!.cn_status : 'NO'}`);
  console.log();
}

// Also check how many placeholders we have vs how many got updated
const { data: allNotes } = await client
  .from("canonical_note_information")
  .select("note_id");

const placeholders = allNotes?.filter(n => n.note_id.startsWith('tweet_')) || [];
console.log(`\nTotal placeholders remaining: ${placeholders.length}`);
console.log(`Total real note IDs: ${(allNotes?.length || 0) - placeholders.length}`);
