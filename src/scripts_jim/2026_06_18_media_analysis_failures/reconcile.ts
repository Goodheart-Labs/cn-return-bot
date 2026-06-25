import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const since = new Date(Date.now() - 10 * 86400000).toISOString();

async function main() {
  // The 46 "%media%" error messages — what are they really?
  const { data: med } = await supabase.from("pipeline_runs")
    .select("outcome, error_message").gte("created_at", since).ilike("error_message", "%media%").limit(50);
  const phrases: Record<string, number> = {};
  for (const r of med ?? []) {
    const m = (r.error_message ?? "").slice(0, 45);
    phrases[`[${r.outcome}] ${m}`] = (phrases[`[${r.outcome}] ${m}`] || 0) + 1;
  }
  console.log("=== error_messages containing 'media' (top phrasings) ===");
  for (const [k,v] of Object.entries(phrases).sort((a,b)=>b[1]-a[1]).slice(0,15)) console.log(`  ${v}x ${k}`);

  // Any "[WARNING]" at all? (warnings concatenated into error_message on non-failed runs)
  const { count: warnCount } = await supabase.from("pipeline_runs")
    .select("id", { count: "exact", head: true }).gte("created_at", since).ilike("error_message", "%[WARNING]%");
  console.log(`\nruns with a [WARNING] in error_message: ${warnCount}`);

  // Of high-demand 503 failures: how many had media vs not (does media presence correlate)?
  const { data: g } = await supabase.from("pipeline_runs")
    .select("media:logs->tweet->post->media, search:logs->search->messages")
    .eq("outcome","failed").ilike("error_message","%high demand%").gte("created_at", since).limit(80);
  let withMedia=0, withSearchLog=0, withoutSearchLog=0;
  for (const r of g ?? []) {
    if (Array.isArray(r.media) && r.media.length>0) withMedia++;
    if (r.search) withSearchLog++; else withoutSearchLog++;
  }
  console.log(`\n503-failed runs: ${(g??[]).length} total | hadMedia=${withMedia} | search step logged(=reached search)=${withSearchLog} | no search log=${withoutSearchLog}`);
}
main().catch(e=>{console.error(e);process.exit(1);});
