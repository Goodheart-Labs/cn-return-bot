import "dotenv/config";
import { getSupabaseClient } from "../src/api/supabaseClient";
const s = getSupabaseClient();

// Most recent pipeline runs
const { data } = await s.from("pipeline_runs")
  .select("bot_id, outcome, created_at")
  .order("created_at", { ascending: false })
  .limit(20);

console.log("Last 20 pipeline runs:");
for (const r of data || []) {
  console.log(`  ${r.created_at} | ${r.bot_id} | ${r.outcome}`);
}
