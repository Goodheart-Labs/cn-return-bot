import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// 1. Scraped notes with "unavailable" tweet IDs
const { data: unavailable } = await supabase
  .from("scraped_notewriter_notes")
  .select("note_id, tweet_id, note_text, created_at")
  .like("tweet_id", "unavailable_%")
  .order("created_at", { ascending: false });

console.log("=== SCRAPED NOTES WITH UNAVAILABLE TWEETS ===");
console.log(`${unavailable?.length || 0} found`);
for (const n of unavailable || []) {
  console.log(`  note_id: ${n.note_id}  tweet_id: ${n.tweet_id}  created: ${n.created_at?.slice(0, 10)}  text: ${(n.note_text || "").slice(0, 80)}`);
}

// 2. Placeholder note IDs still in DB (tweet_XXX format)
const { data: placeholders } = await supabase
  .from("scraped_notewriter_notes")
  .select("note_id, tweet_id, note_text, created_at")
  .like("note_id", "tweet_%")
  .order("created_at", { ascending: false });

console.log(`\n=== PLACEHOLDER NOTE IDS (tweet_XXX) ===`);
console.log(`${placeholders?.length || 0} found`);
for (const n of (placeholders || []).slice(0, 15)) {
  console.log(`  note_id: ${n.note_id}  tweet_id: ${n.tweet_id}  created: ${n.created_at?.slice(0, 10)}  text: ${(n.note_text || "").slice(0, 80)}`);
}

// 3. Snapshots referencing note_ids that don't exist in scraped_notewriter_notes
const { data: allSnapshots } = await supabase
  .from("scraped_notewriter_snapshots")
  .select("note_id, cn_status, scraped_at");
const { data: allScrapedNotes } = await supabase
  .from("scraped_notewriter_notes")
  .select("note_id");

const scrapedNoteIds = new Set((allScrapedNotes || []).map(n => n.note_id));
const orphanSnapshots = (allSnapshots || []).filter(s => !scrapedNoteIds.has(s.note_id));
const orphanByNote = new Map<string, number>();
for (const s of orphanSnapshots) {
  orphanByNote.set(s.note_id, (orphanByNote.get(s.note_id) || 0) + 1);
}

console.log(`\n=== ORPHAN SNAPSHOTS (note_id not in scraped_notewriter_notes) ===`);
console.log(`${orphanSnapshots.length} snapshots for ${orphanByNote.size} unique note_ids`);
for (const [noteId, count] of [...orphanByNote.entries()].slice(0, 15)) {
  console.log(`  note_id: ${noteId}  snapshots: ${count}`);
}

// 4. Scraped notes with missing/empty note_text
const { data: emptyText } = await supabase
  .from("scraped_notewriter_notes")
  .select("note_id, tweet_id, note_text, created_at")
  .or("note_text.is.null,note_text.eq.");

console.log(`\n=== SCRAPED NOTES WITH EMPTY/NULL TEXT ===`);
console.log(`${emptyText?.length || 0} found`);
for (const n of (emptyText || []).slice(0, 15)) {
  console.log(`  note_id: ${n.note_id}  tweet_id: ${n.tweet_id}  created: ${n.created_at?.slice(0, 10)}`);
}

// 5. Notes in our notes table that have no matching scraped entry
const { data: ourNotes } = await supabase.from("notes").select("note_id, tweet_id, bot_name, submitted_at");
const unmatched = (ourNotes || []).filter(n => !scrapedNoteIds.has(n.note_id));
console.log(`\n=== OUR NOTES NOT IN SCRAPED DATA ===`);
console.log(`${unmatched.length} of ${ourNotes?.length} notes have no scraped match`);
for (const n of unmatched.slice(0, 20)) {
  const url = `https://x.com/i/status/${n.tweet_id}`;
  console.log(`  note_id: ${n.note_id}  bot: ${n.bot_name}  date: ${n.submitted_at?.slice(0, 10)}  ${url}`);
}
