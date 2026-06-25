import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const MS = 86400000;

const count = async (build: (q: any) => any) => {
  const { count, error } = await build(
    supabase.from("pipeline_runs").select("id", { count: "exact", head: true }),
  );
  if (error) throw error;
  return count ?? 0;
};

async function main() {
  const todayStart = Math.floor(Date.now() / MS) * MS;
  console.log("\nDay         | total runs | failed (any) | failed: Gemini 503 | 503 % of runs");
  console.log("------------|------------|--------------|--------------------|-------------");
  let tT = 0, tF = 0, tG = 0;
  for (let i = 9; i >= 0; i--) {
    const s = new Date(todayStart - i * MS).toISOString();
    const e = new Date(todayStart - (i - 1) * MS).toISOString();
    const range = (q: any) => q.gte("created_at", s).lt("created_at", e);
    const total = await count(range);
    const failed = await count((q) => range(q).eq("outcome", "failed"));
    const gem = await count((q) =>
      range(q).eq("outcome", "failed").or("error_message.ilike.%high demand%,error_message.ilike.%UNAVAILABLE%"),
    );
    tT += total; tF += failed; tG += gem;
    const pct = total ? ((gem / total) * 100).toFixed(1) : "—";
    console.log(
      `${s.slice(0,10)}  | ${String(total).padStart(10)} | ${String(failed).padStart(12)} | ${String(gem).padStart(18)} | ${pct.padStart(11)}`,
    );
  }
  console.log("------------|------------|--------------|--------------------|-------------");
  const tpct = tT ? ((tG / tT) * 100).toFixed(1) : "—";
  console.log(`TOTAL       | ${String(tT).padStart(10)} | ${String(tF).padStart(12)} | ${String(tG).padStart(18)} | ${tpct.padStart(11)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
