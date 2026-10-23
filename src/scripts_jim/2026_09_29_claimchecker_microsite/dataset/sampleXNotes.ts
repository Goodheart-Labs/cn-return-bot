/**
 * Draws tweets uniformly at random from the tweets without media, their own or a quoted tweet's, on which our X
 * notewriter wrote a note that raters judged helpful, and saves each tweet with
 * its note in xSample.json.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/sampleXNotes.ts [count]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { join } from "path";
import { LAB_DIR } from "../runStore";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const IN_BATCH = 100;

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const count = Number(process.argv[2] ?? 10);
const PAGE = 1000;
const notes: {
  note_id: string; tweet_id: string; note_text: string | null; source_url: string | null; cn_status: string | null;
  helpful_count: number | null; somewhat_helpful_count: number | null; not_helpful_count: number | null; submitted_at: string | null;
}[] = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from("notes")
    .select("note_id, tweet_id, note_text, source_url, cn_status, helpful_count, somewhat_helpful_count, not_helpful_count, submitted_at")
    .eq("cn_status", "CURRENTLY_RATED_HELPFUL")
    .order("note_id")
    .range(from, from + PAGE - 1);
  if (error) throw error;
  notes.push(...data);
  if (data.length < PAGE) break;
}

const pool: { note: (typeof notes)[number]; tweet: Record<string, unknown> }[] = [];
for (let from = 0; from < notes.length; from += IN_BATCH) {
  const batch = notes.slice(from, from + IN_BATCH);
  const { data: tweets, error: tweetError } = await db.from("tweets").select("*").in("tweet_id", batch.map((n) => n.tweet_id));
  if (tweetError) throw tweetError;
  for (const tweet of tweets) {
    const quotedMedia = ((tweet.referenced_tweet_data as { media?: unknown[] } | null)?.media ?? []).length > 0;
    const hasMedia = ((tweet.media as unknown[] | null) ?? []).length > 0 || tweet.has_photo || tweet.has_video || quotedMedia;
    const note = batch.find((n) => n.tweet_id === tweet.tweet_id)!;
    if (!hasMedia && tweet.text && note.note_text) pool.push({ note, tweet });
  }
}
console.log(`${notes.length} helpful notes, ${pool.length} on tweets without media`);
const chosen = shuffled(pool).slice(0, count);
writeFileSync(join(LAB_DIR, "dataset", "xSample.json"), JSON.stringify({ drawnAt: new Date().toISOString(), poolSize: pool.length, posts: chosen }, null, 1));
for (const { note, tweet } of chosen) console.log(tweet.tweet_id, "|", String(tweet.text).replace(/\s+/g, " ").slice(0, 110));
