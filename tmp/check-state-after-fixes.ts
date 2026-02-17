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

const scrapedNotes = await fetchAll<{ note_id: string; tweet_id: string; note_text: string }>(
  "scraped_notewriter_notes", "note_id, tweet_id, note_text"
);

const tweetToNotes = new Map<string, typeof scrapedNotes>();
for (const n of scrapedNotes) {
  if (!tweetToNotes.has(n.tweet_id)) tweetToNotes.set(n.tweet_id, []);
  tweetToNotes.get(n.tweet_id)!.push(n);
}
const remaining = [...tweetToNotes.entries()].filter(([_, ns]) => ns.length > 1);

console.log(`Total notes: ${scrapedNotes.length}`);
console.log(`Remaining duplicate tweet_ids: ${remaining.length}\n`);

for (const [tweetId, noteList] of remaining) {
  console.log(`Tweet ${tweetId} (${noteList.length} notes):`);
  for (const n of noteList) {
    console.log(`  ${n.note_id} | ${n.note_text?.slice(0, 80) || "(no text)"}`);
  }
  console.log();
}
