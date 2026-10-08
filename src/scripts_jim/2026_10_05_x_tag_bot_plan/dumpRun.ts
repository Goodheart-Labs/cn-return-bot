// Save the latest production pipeline_runs row of one tweet, to build the
// plan's example from the real input.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "fs";

const tweetId = process.argv[2]!;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: run, error } = await db
  .from("pipeline_runs")
  .select("*")
  .eq("tweet_id", tweetId)
  .order("created_at", { ascending: false })
  .limit(1)
  .single();
if (error) throw error;
const { data: tweet } = await db.from("tweets").select("*").eq("id", tweetId).maybeSingle();

const outputDir = `${import.meta.dir}/output`;
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/run_${tweetId}.json`, JSON.stringify({ run, tweet }, null, 2));
console.log(Object.keys(run), "\nlog keys:", Object.keys(run.logs ?? {}));
