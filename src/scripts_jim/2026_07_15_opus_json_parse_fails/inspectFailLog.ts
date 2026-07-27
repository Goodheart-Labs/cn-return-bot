import { getSupabaseClient } from "../../api/supabaseClient";
const db = getSupabaseClient();
// one Opus-search failure run: find via error_message prefix + opus search_model
const { data } = await db.from("pipeline_runs")
  .select("id, tweet_id, error_message, logs, bot_config")
  .eq("outcome_reason","model_output_invalid")
  .ilike("error_message","searchWithAnthropicNative%")
  .order("created_at",{ascending:false})
  .limit(1);
const r:any = data?.[0];
console.log("run", r.id, "tweet", r.tweet_id);
console.log("search_model:", r.bot_config?.search_model, "| model:", r.bot_config?.model);
console.log("\n=== top-level log keys ===");
console.log(Object.keys(r.logs ?? {}));
// try to find the search step keys
const logs = r.logs ?? {};
for (const k of Object.keys(logs)) {
  if (k.toLowerCase().includes("search")) {
    console.log(`\n[${k}] subkeys:`, typeof logs[k]==="object"? Object.keys(logs[k]) : typeof logs[k]);
  }
}
console.log("\n=== full error_message ===\n", (r.error_message??"").slice(0,600));
process.exit(0);
