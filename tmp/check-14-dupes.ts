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
const botNotes = await fetchAll<{ note_id: string; tweet_id: string }>(
  "notes", "note_id, tweet_id"
);

const botMap = new Map(botNotes.map(n => [n.note_id, n.tweet_id]));

// Find remaining duplicate tweet_ids
const tweetToNotes = new Map<string, typeof scrapedNotes>();
for (const n of scrapedNotes) {
  if (!tweetToNotes.has(n.tweet_id)) tweetToNotes.set(n.tweet_id, []);
  tweetToNotes.get(n.tweet_id)!.push(n);
}
const dupes = [...tweetToNotes.entries()].filter(([_, ns]) => ns.length > 1);

console.log(`${dupes.length} tweet_ids with multiple notes\n`);

let fixableFromBot = 0;
let unfixable = 0;

for (const [tweetId, noteList] of dupes) {
  console.log(`Tweet ${tweetId}:`);
  for (const n of noteList) {
    const botTweetId = botMap.get(n.note_id);
    const match = botTweetId ? (botTweetId === tweetId ? "MATCHES" : `WRONG — bot says ${botTweetId}`) : "not in notes table";
    const text = n.note_text?.slice(0, 80) || "(no text)";
    console.log(`  ${n.note_id} | bot: ${match}`);
    console.log(`    ${text}`);
    if (botTweetId && botTweetId !== tweetId) fixableFromBot++;
    if (!botTweetId) unfixable++;
  }
  console.log();
}

console.log(`\nFixable from notes table: ${fixableFromBot}`);
console.log(`Not in notes table (can't auto-fix): ${unfixable}`);
