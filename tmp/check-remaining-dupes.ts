import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

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

const notes = await fetchAll<{ note_id: string; tweet_id: string; created_at: string; note_text: string }>(
  "scraped_notewriter_notes", "note_id, tweet_id, created_at, note_text"
);

console.log("Total notes after cleanup:", notes.length);

// Find remaining duplicate tweet_ids
const tweetToNotes = new Map<string, typeof notes>();
for (const n of notes) {
  if (!tweetToNotes.has(n.tweet_id)) tweetToNotes.set(n.tweet_id, []);
  tweetToNotes.get(n.tweet_id)!.push(n);
}
const remaining = [...tweetToNotes.entries()].filter(([_, ns]) => ns.length > 1);

console.log("Remaining tweets with multiple notes:", remaining.length);
console.log("\nThese have WRONG tweet_ids (actually different tweets):\n");

for (const [tweetId, noteList] of remaining) {
  console.log(`Tweet ${tweetId} (${noteList.length} notes) — https://x.com/i/web/status/${tweetId}`);
  for (const n of noteList.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const textPreview = n.note_text?.slice(0, 100) || "(no text)";
    console.log(`  ${n.note_id} | ${n.created_at?.slice(0, 10)} | ${textPreview}`);
  }
  console.log();
}
