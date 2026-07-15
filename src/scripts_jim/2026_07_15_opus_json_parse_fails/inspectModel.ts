import { getSupabaseClient } from "../../api/supabaseClient";
const db = getSupabaseClient();
const { data } = await db.from("pipeline_runs")
  .select("id, bot_name, bot_config, ab_test_picks, outcome_reason, error_message")
  .order("created_at",{ascending:false}).limit(3);
for (const r of data ?? []) {
  console.log("=== run", (r as any).id, "===");
  console.log("ab_test_picks:", JSON.stringify((r as any).ab_test_picks, null, 2));
  console.log("bot_config:", JSON.stringify((r as any).bot_config, null, 2));
}
process.exit(0);
