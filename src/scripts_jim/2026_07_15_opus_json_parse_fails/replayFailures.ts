import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseClient } from "../../api/supabaseClient";
import { llm } from "../../pipeline/llm/llm";
import { extractJsonObject } from "../../pipeline/utils/jsonOutput";

const db = getSupabaseClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const N = 14;

// 1) ids only (small)
const idsRes = await db.from("pipeline_runs")
  .select("id, bot_config, error_message")
  .eq("outcome_reason","model_output_invalid")
  .gte("created_at","2026-07-13T00:00:00Z")
  .order("created_at",{ascending:false}).limit(400);
if (idsRes.error) { console.error("ids query error", idsRes.error); process.exit(1); }
const runs = (idsRes.data as any[]).filter(r => (r.error_message??"").startsWith("searchWithAnthropicNative")).slice(0, N);
console.log("search-failure runs fetched:", runs.length);

function directModelId(orId: string){ return orId.replace(/^anthropic\//,"").replace(/\./g,"-"); }
function prodOk(raw: string){ try { const p=JSON.parse(extractJsonObject(raw??"")) as any;
  return typeof p.findings==="string" && typeof p.correction_needed==="boolean"; } catch { return false; } }
async function viaOpenRouter(model:string,sys:string,user:string){ const r:any=await llm.create({model,
  messages:[{role:"system",content:[{type:"text",text:sys,cache_control:{type:"ephemeral"}}]},{role:"user",content:user}],
  tools:[{type:"web_search_20260209",name:"web_search"}]} as any); return r.choices?.[0]?.message?.content ?? ""; }
async function viaDirect(model:string,sys:string,user:string){ const r:any=await anthropic.messages.create({model,max_tokens:4096,
  system:sys,messages:[{role:"user",content:user}],tools:[{type:"web_search_20250305",name:"web_search",max_uses:5} as any]});
  return r.content.filter((b:any)=>b.type==="text").map((b:any)=>b.text).join(""); }

let orOk=0,orN=0,dOk=0,dN=0; const mc:Record<string,number>={}; const derrs:string[]=[];
for (const run of runs) {
  // fetch this run's logs alone
  const one = await db.from("pipeline_runs").select("logs").eq("id",run.id).single();
  if (one.error) { console.log(run.id,"logs err",one.error.message?.slice(0,60)); continue; }
  const step = (one.data as any)?.logs?.note_writer_steps?.search?.messages?.["0"];
  if (!step?.userMessage) { console.log(run.id,"no userMessage"); continue; }
  const orModel = run.bot_config?.search_model ?? run.bot_config?.model;
  mc[orModel]=(mc[orModel]??0)+1;
  const dModel = directModelId(orModel);
  const sys=step.systemPrompt??""; const user=step.userMessage;
  try { const ok=prodOk(await viaOpenRouter(orModel,sys,user)); orN++; if(ok)orOk++; process.stdout.write(ok?"o":"O"); }
  catch(e:any){ orN++; process.stdout.write("e"); }
  try { const ok=prodOk(await viaDirect(dModel,sys,user)); dN++; if(ok)dOk++; process.stdout.write(ok?"d":"D"); }
  catch(e:any){ dN++; derrs.push(`${dModel}: ${e.status??""} ${(e.message??"").slice(0,70)}`); process.stdout.write("!"); }
}
console.log(`\n\nReplaying ${runs.length} PROD-FAILED search inputs. models=${JSON.stringify(mc)}`);
console.log(`OpenRouter (prod path) re-run: OK ${orOk}/${orN} = ${orN?(100*orOk/orN).toFixed(1):"-"}%`);
console.log(`Direct Anthropic re-run:       OK ${dOk}/${dN} = ${dN?(100*dOk/dN).toFixed(1):"-"}%`);
if (derrs.length) console.log("direct errors:\n  "+derrs.join("\n  "));
process.exit(0);
