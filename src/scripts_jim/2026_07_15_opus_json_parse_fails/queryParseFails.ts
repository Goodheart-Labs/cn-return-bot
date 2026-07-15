import { getSupabaseClient } from "../../api/supabaseClient";

const db = getSupabaseClient();

const reasons = await db
  .from("pipeline_runs")
  .select("outcome_reason")
  .eq("outcome", "failed")
  .order("created_at", { ascending: false })
  .limit(10000);

const counts: Record<string, number> = {};
for (const r of reasons.data ?? []) {
  const k = (r as any).outcome_reason ?? "null";
  counts[k] = (counts[k] ?? 0) + 1;
}
console.log("=== recent failed pipeline_runs by outcome_reason ===");
console.log(counts);

const { data, error } = await db
  .from("pipeline_runs")
  .select("id, tweet_id, created_at, bot_name, final_stage, outcome_reason, error_message")
  .eq("outcome_reason", "model_output_invalid")
  .order("created_at", { ascending: false })
  .limit(8);

if (error) { console.error("query error", error); process.exit(1); }

console.log(`\n=== model_output_invalid examples: ${data?.length ?? 0} ===`);
for (const row of data ?? []) {
  const r = row as any;
  console.log("\n----------------------------------------");
  console.log("run", r.id, "| tweet", r.tweet_id, "| bot", r.bot_name, "| stage", r.final_stage);
  console.log("when:", r.created_at);
  console.log("error_message:", (r.error_message ?? "").slice(0, 1500));
}
process.exit(0);
