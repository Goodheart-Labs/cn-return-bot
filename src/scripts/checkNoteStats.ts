import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";

const client = getSupabaseClient();

// Check scraped_notewriter_notes table
const { count: notesCount } = await client
  .from("scraped_notewriter_notes")
  .select("*", { count: "exact", head: true });

const { count: snapshotsCount } = await client
  .from("scraped_notewriter_snapshots")
  .select("*", { count: "exact", head: true });

console.log("Total scraped_notewriter_notes:", notesCount);
console.log("Total scraped_notewriter_snapshots:", snapshotsCount);

// Count real vs placeholder IDs
const { data: allNotes } = await client
  .from("scraped_notewriter_notes")
  .select("note_id");

const realIds = allNotes?.filter(n => !n.note_id.startsWith('tweet_')).length || 0;
const placeholderIds = allNotes?.filter(n => n.note_id.startsWith('tweet_')).length || 0;
console.log("\nReal note IDs:", realIds);
console.log("Placeholder IDs (tweet_XXX):", placeholderIds);

// Check oldest and newest notes by note_id (note IDs are timestamps)
const { data: oldest } = await client
  .from("scraped_notewriter_notes")
  .select("note_id, tweet_id")
  .not("note_id", "like", "tweet_%")
  .order("note_id", { ascending: true })
  .limit(3);

console.log("\nOldest notes (by note_id):");
oldest?.forEach(n => console.log(`  ${n.note_id} → ${n.tweet_id}`));

const { data: newest } = await client
  .from("scraped_notewriter_notes")
  .select("note_id, tweet_id")
  .not("note_id", "like", "tweet_%")
  .order("note_id", { ascending: false })
  .limit(3);

console.log("\nNewest notes (by note_id):");
newest?.forEach(n => console.log(`  ${n.note_id} → ${n.tweet_id}`))
