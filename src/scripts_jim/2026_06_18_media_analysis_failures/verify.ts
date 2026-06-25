import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const since = new Date(Date.now() - 10 * 86400000).toISOString();

async function main() {
  // any error_message mentioning media/gemini?
  for (const pat of ["%Media analysis failed%", "%gemini%", "%media%", "%high demand%", "%UNAVAILABLE%", "%503%"]) {
    const { count } = await supabase.from("pipeline_runs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since).ilike("error_message", pat);
    console.log(`error_message ILIKE ${pat.padEnd(26)} -> ${count}`);
  }
  // total non-null error_message (sanity: detector works, there ARE errors)
  const { count: nonNull } = await supabase.from("pipeline_runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since).not("error_message", "is", null);
  console.log(`\nnon-null error_message total -> ${nonNull}`);
  // sample a few error messages
  const { data } = await supabase.from("pipeline_runs")
    .select("created_at, outcome, error_message")
    .gte("created_at", since).not("error_message", "is", null).limit(12);
  console.log("\nsample error messages:");
  for (const r of data ?? []) console.log(`  [${r.outcome}] ${r.error_message?.slice(0,110)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
