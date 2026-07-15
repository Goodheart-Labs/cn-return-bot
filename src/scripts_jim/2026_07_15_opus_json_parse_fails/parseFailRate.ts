import { getSupabaseClient } from "../../api/supabaseClient";
const db = getSupabaseClient();

// distinct bot_names to know which are Opus
const bots = await db.from("pipeline_runs").select("bot_name").order("created_at",{ascending:false}).limit(20000);
const botCounts: Record<string,number> = {};
for (const r of bots.data ?? []) { const k=(r as any).bot_name ?? "null"; botCounts[k]=(botCounts[k]??0)+1; }
console.log("bot_name distribution (recent 20k):", botCounts);

async function count(filter: (q:any)=>any) {
  const { count, error } = await filter(db.from("pipeline_runs").select("*", { count: "exact", head: true }));
  if (error) throw error;
  return count ?? 0;
}

// Window: last 14 days
const since = "2026-07-01T00:00:00Z";
for (const bot of Object.keys(botCounts)) {
  const total = await count((q:any)=>q.eq("bot_name",bot).gte("created_at",since));
  if (total === 0) continue;
  const invalid = await count((q:any)=>q.eq("bot_name",bot).eq("outcome_reason","model_output_invalid").gte("created_at",since));
  console.log(`${bot}: ${invalid}/${total} = ${(100*invalid/total).toFixed(2)}% model_output_invalid (since ${since})`);
}
process.exit(0);
