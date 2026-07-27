import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";
import { withBotConfig } from "../../pipeline/ab-testing/botConfig";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";

const db = getSupabaseClient();
// fetch a few recent prod-FAILED anthropic-native search inputs
const res = await db.from("pipeline_runs")
  .select("id, bot_config, error_message")
  .eq("outcome_reason","model_output_invalid")
  .gte("created_at","2026-07-13T00:00:00Z")
  .order("created_at",{ascending:false}).limit(400);
const fails = (res.data as any[]).filter(r => (r.error_message??"").startsWith("searchWithAnthropicNative")).slice(0,6);
console.log(`Driving dispatchSearch (NEW retry path) on ${fails.length} prod-FAILED inputs:\n`);

let ok=0;
for (const run of fails) {
  const one = await db.from("pipeline_runs").select("logs").eq("id",run.id).single();
  const step = (one.data as any)?.logs?.note_writer_steps?.search?.messages?.["0"];
  if (!step?.userMessage) { console.log(run.id.slice(0,8),"no input"); continue; }
  const searchModel = run.bot_config?.search_model ?? run.bot_config?.model;
  const config:any = { botId:"verify", model:searchModel, search_model:searchModel, web_search:"native",
    simple_prompts: run.bot_config?.simple_prompts ?? false };
  try {
    const r = await withBotConfig(config, () => dispatchSearch(step.userMessage, "verify-search"));
    const good = typeof r.findings==="string" && r.findings.length>0 && typeof r.correctionNeeded==="boolean";
    if (good) ok++;
    console.log(`${run.id.slice(0,8)} [${searchModel.replace('anthropic/','')}] => ${good?"OK":"BAD"} findings=${r.findings.length}c correctionNeeded=${r.correctionNeeded}`);
  } catch(e:any) {
    console.log(`${run.id.slice(0,8)} [${searchModel.replace('anthropic/','')}] => THREW ${e.constructor.name}: ${(e.message??"").slice(0,70)}`);
  }
}
console.log(`\nRecovered ${ok}/${fails.length} of previously-failed inputs via the retry path.`);
process.exit(0);
