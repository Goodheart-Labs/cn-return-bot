import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const since = new Date(Date.now() - 10 * 86400000).toISOString();

async function main() {
  const { data, error } = await supabase.from("pipeline_runs")
    .select("created_at, bot_name, ab_test_picks, stack:logs->error->stack")
    .eq("outcome", "failed").eq("final_stage", "error")
    .ilike("error_message", "%high demand%")
    .gte("created_at", since).limit(6);
  if (error) throw error;
  for (const r of data ?? []) {
    console.log("=== ", r.created_at, r.bot_name, JSON.stringify(r.ab_test_picks));
    console.log(String(r.stack ?? "(no stack)").split("\n").slice(0,8).join("\n"));
    console.log();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
