import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: failed } = await supabase
  .from("pipeline_runs")
  .select("tweet_id, bot_id, outcome_reason, error_message, created_at")
  .eq("outcome", "failed")
  .order("created_at", { ascending: false });

// Group by tweet_id
const byTweet = new Map<string, NonNullable<typeof failed>>();
for (const r of failed || []) {
  if (!byTweet.has(r.tweet_id)) byTweet.set(r.tweet_id, []);
  byTweet.get(r.tweet_id)!.push(r);
}

// Sort by failure count descending
const sorted = [...byTweet.entries()].sort((a, b) => b[1].length - a[1].length);

console.log(`=== TWEETS WITH MOST PIPELINE FAILURES ===\n`);
console.log(`Total unique tweets that failed: ${sorted.length}\n`);

for (const [tweetId, runs] of sorted.slice(0, 30)) {
  const url = `https://x.com/i/status/${tweetId}`;
  const dates = runs.map(r => r.created_at?.slice(0, 16)).join(", ");
  const bots = [...new Set(runs.map(r => r.bot_id))].join(", ");
  const reason = runs[0]!.outcome_reason || "";
  const err = (runs[0]!.error_message || "").slice(0, 120);
  console.log(`Tweet: ${url}`);
  console.log(`  Failures: ${runs.length} | Bots: ${bots}`);
  console.log(`  Reason: ${reason}`);
  console.log(`  Error: ${err}`);
  console.log(`  Dates: ${dates}`);
  console.log();
}
