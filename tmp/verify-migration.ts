import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// Test inserting a snapshot with tweet_id then deleting it
const { error: e1 } = await client.from("scraped_notewriter_snapshots")
  .select("tweet_id")
  .limit(1);
console.log("snapshots.tweet_id column:", e1 ? "MISSING - " + e1.message : "OK");

const { error: e2 } = await client.from("scraped_notewriter_notes")
  .select("tweet_id_flag")
  .limit(1);
console.log("notes.tweet_id_flag column:", e2 ? "MISSING - " + e2.message : "OK");
