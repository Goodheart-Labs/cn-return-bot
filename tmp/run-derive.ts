import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// First check: how many snapshots have tweet_id populated?
const { data: withTweetId, error: e1 } = await client
  .from("scraped_notewriter_snapshots")
  .select("note_id", { count: "exact" })
  .not("tweet_id", "is", null)
  .limit(1);

const { count } = await client
  .from("scraped_notewriter_snapshots")
  .select("*", { count: "exact", head: true })
  .not("tweet_id", "is", null);

console.log(`Snapshots with tweet_id populated: ${count || 0}`);

if (!count || count === 0) {
  console.log("\nNo snapshots have tweet_id yet. The scraper needs to run with the updated code.");
  console.log("Was the scrape using the latest code (with tweet_id in snapshot inserts)?");
  process.exit(0);
}

// Run derivation
import { SupabaseLogger } from "../src/api/supabaseClient";
const supabase = new SupabaseLogger();
console.log("\nRunning deriveTweetIds...");
const result = await supabase.deriveTweetIds();
console.log(`Total notes:  ${result.total}`);
console.log(`Updated:      ${result.updated}`);
console.log(`Flagged:      ${result.flagged}`);
console.log(`No votes yet: ${result.noVotes}`);

// Show flagged notes
if (result.flagged > 0) {
  const { data: flagged } = await client
    .from("scraped_notewriter_notes")
    .select("note_id, tweet_id, tweet_id_flag, note_text")
    .not("tweet_id_flag", "is", null);

  console.log(`\n=== Flagged notes ===`);
  for (const f of flagged || []) {
    console.log(`\n${f.note_id}`);
    console.log(`  tweet_id: ${f.tweet_id}`);
    console.log(`  flag: ${f.tweet_id_flag}`);
    console.log(`  text: ${f.note_text?.slice(0, 100) || "(no text)"}`);
  }
}
