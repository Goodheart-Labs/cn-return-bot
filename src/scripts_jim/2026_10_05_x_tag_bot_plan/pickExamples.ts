// Find recent tweets whose notes became helpful, to use as the plan's worked example.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: notes, error } = await db
  .from("notes")
  .select("tweet_id, note_text, cn_status, submitted_at")
  .eq("cn_status", "CURRENTLY_RATED_HELPFUL")
  .gte("submitted_at", "2026-09-20T00:00:00Z")
  .order("submitted_at", { ascending: false })
  .limit(25);
if (error) throw error;

for (const note of notes) {
  const { data: tweet } = await db.from("tweets").select("text, author_name").eq("id", note.tweet_id).maybeSingle();
  console.log(`\n=== ${note.tweet_id} ${note.submitted_at}\nTWEET (${tweet?.author_name}): ${tweet?.text?.slice(0, 300)}\nNOTE: ${note.note_text}`);
}
