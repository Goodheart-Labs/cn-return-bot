import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// The two notes from the screenshot
const noteIds = ["1992984995401519335", "2013402976019181815"];

for (const noteId of noteIds) {
  const { data, error } = await client.from("scraped_notewriter_notes")
    .select("*")
    .eq("note_id", noteId)
    .single();
  if (error) { console.log(noteId, "ERROR:", error.message); continue; }
  console.log(`\nNote ${noteId}:`);
  console.log(`  tweet_id: ${data.tweet_id}`);
  console.log(`  created_at: ${data.created_at}`);
  console.log(`  source_url: ${data.source_url}`);
  console.log(`  text: ${data.note_text?.slice(0, 150)}`);
}

// Now check: how many of the 73 "duplicate tweet" cases might actually be wrong tweet_id mappings?
// If two notes for the same tweet have identical text, the tweet_id is probably wrong on one
async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.from(table).select(select).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

const allNotes = await fetchAll<{ note_id: string; tweet_id: string; note_text: string; source_url: string }>(
  "scraped_notewriter_notes", "note_id, tweet_id, note_text, source_url"
);

const tweetToNotes = new Map<string, typeof allNotes>();
for (const n of allNotes) {
  if (!tweetToNotes.has(n.tweet_id)) tweetToNotes.set(n.tweet_id, []);
  tweetToNotes.get(n.tweet_id)!.push(n);
}

const multiNotes = [...tweetToNotes.entries()].filter(([_, ns]) => ns.length > 1);

let sameText = 0;
let diffText = 0;
let noText = 0;
let diffSourceUrl = 0;

for (const [tweetId, noteList] of multiNotes) {
  const texts = noteList.map(n => n.note_text?.trim() || "");
  const urls = noteList.map(n => n.source_url || "");

  const allHaveText = texts.every(t => t.length > 0);
  if (!allHaveText) { noText++; continue; }

  // Check if all texts are the same
  const uniqueTexts = new Set(texts);
  if (uniqueTexts.size === 1) {
    sameText++;
  } else {
    diffText++;
  }

  // Check source URLs
  const uniqueUrls = new Set(urls.filter(u => u.length > 0));
  if (uniqueUrls.size > 1) diffSourceUrl++;
}

console.log("\n=== Analysis of 'duplicate tweet' notes ===");
console.log("Total tweet groups with multiple notes:", multiNotes.length);
console.log("Same text (likely wrong tweet_id):", sameText);
console.log("Different text (likely genuine re-submissions):", diffText);
console.log("Missing text (can't determine):", noText);
console.log("Different source URLs:", diffSourceUrl);

// Show the same-text cases
console.log("\n=== Same-text cases (likely bad tweet_id mapping) ===");
for (const [tweetId, noteList] of multiNotes) {
  const texts = noteList.map(n => n.note_text?.trim() || "");
  if (texts.some(t => !t)) continue;
  const uniqueTexts = new Set(texts);
  if (uniqueTexts.size === 1) {
    console.log(`\nTweet ${tweetId} (${noteList.length} notes, same text):`);
    for (const n of noteList) {
      console.log(`  ${n.note_id} | source: ${n.source_url || "none"}`);
    }
  }
}
