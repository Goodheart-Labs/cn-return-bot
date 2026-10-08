// Find recent runs where the search stage said no correction was needed, to use
// as the plan's "no note needed" example. Prints the tweet text and findings.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: runs, error } = await db
  .from("pipeline_runs")
  .select("tweet_id, tweetText:logs->tweet->post->raw->>text, search:logs->note_writer_steps->search->messages->1")
  .gte("created_at", "2026-10-04T00:00:00Z")
  .eq("outcome_reason", "no_correction_needed")
  .order("created_at", { ascending: false })
  .limit(30);
if (error) throw error;
for (const run of runs) {
  console.log(`\n=== ${run.tweet_id}\nTWEET: ${String(run.tweetText).slice(0, 300)}\nSEARCH: ${JSON.stringify(run.search).slice(0, 400)}`);
}
