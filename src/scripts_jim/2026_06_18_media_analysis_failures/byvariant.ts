import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const since = new Date(Date.now() - 10 * 86400000).toISOString();
const pick = (q:any)=>q.gte("created_at", since).eq("bot_name","simple-bot");
async function main() {
  // failures by search variant
  const { data: f } = await supabase.from("pipeline_runs")
    .select("v:ab_test_picks->>simple_bot_search").eq("outcome","failed").ilike("error_message","%high demand%").gte("created_at", since);
  const fail: Record<string,number>={}; for(const r of f??[]) fail[(r as any).v??"?"]=(fail[(r as any).v??"?"]||0)+1;
  console.log("503 FAILURES by simple_bot_search variant:", fail);
  // total runs per search variant (volume) — count per distinct variant
  for (const v of Object.keys(fail)) {
    const { count: total } = await supabase.from("pipeline_runs").select("id",{count:"exact",head:true})
      .gte("created_at", since).eq("ab_test_picks->>simple_bot_search", v);
    const { count: failed } = await supabase.from("pipeline_runs").select("id",{count:"exact",head:true})
      .gte("created_at", since).eq("ab_test_picks->>simple_bot_search", v).eq("outcome","failed");
    console.log(`  variant ${v}: ${total} runs, ${failed} failed (${total?((failed!/total)*100).toFixed(1):"—"}% any-fail)`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
