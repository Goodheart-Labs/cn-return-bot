import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const since = new Date(Date.now() - 10 * 86400000).toISOString();
async function main() {
  const { data } = await supabase.from("pipeline_runs")
    .select("created_at, logs").eq("outcome","failed").ilike("error_message","%high demand%")
    .gte("created_at", since).limit(3);
  for (const r of data ?? []) {
    const logs = r.logs as Record<string, any>;
    console.log("===", r.created_at, "top-level log keys:", Object.keys(logs ?? {}).join(", "));
    if (logs?.simple_bot_steps) console.log("  simple_bot_steps keys:", Object.keys(logs.simple_bot_steps).join(", "));
    if (logs?.search) console.log("  search keys:", Object.keys(logs.search).join(", "));
    // print any keys that look like steps
    for (const k of Object.keys(logs ?? {})) {
      if (typeof logs[k] === "object" && logs[k] && !Array.isArray(logs[k]))
        console.log(`  ${k}.* ->`, Object.keys(logs[k]).slice(0,8).join(", "));
    }
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
