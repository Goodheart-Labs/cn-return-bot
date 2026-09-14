import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const ids = process.argv.slice(2);
const { data, error } = await db.from("pipeline_runs").select("tweet_id, created_at, outcome, outcome_reason, error_message, final_stage, cost, logs").in("tweet_id", ids).order("created_at");
if (error) throw error;
for (const r of data!) {
  console.log(`\n=== ${r.tweet_id} created ${r.created_at} outcome=${r.outcome} reason=${r.outcome_reason} stage=${r.final_stage} cost=${r.cost}`);
  if (r.error_message) console.log("error:", String(r.error_message).slice(0, 300));
  for (const e of r.logs?.costs?.entries ?? []) console.log("  cost", e.name, "in", e.input_tokens, "out", e.output_tokens, "$", e.cost?.toFixed?.(4));
  const pf = r.logs?.note_prefilter ?? {};
  for (const [k, v] of Object.entries(pf)) if (!/messages/.test(k)) console.log("  prefilter", k, JSON.stringify(v).slice(0, 300));
  const pfKeys = Object.keys(r.logs ?? {}).filter((k) => /prefilter|timing|duration/i.test(k));
  console.log("  top-level log keys:", Object.keys(r.logs ?? {}).join(", "));
}
