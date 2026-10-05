// How did the Signal bot's hand-picked submissions fare? This tells us whether
// X accepts notes on posts that were never in the eligibility feed.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: signalRuns, error } = await db
  .from("pipeline_runs")
  .select("tweet_id, outcome, created_at")
  .eq("bot_name", "signal");
if (error) throw error;

for (const run of signalRuns) {
  const { data: otherRuns } = await db
    .from("pipeline_runs")
    .select("bot_name, outcome, created_at")
    .eq("tweet_id", run.tweet_id)
    .neq("bot_name", "signal");
  const { data: notes } = await db.from("notes").select("*").eq("tweet_id", run.tweet_id);
  console.log({ signalRun: run, automaticRunsOnSameTweet: otherRuns, notes });
}
