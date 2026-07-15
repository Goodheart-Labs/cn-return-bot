import { getSupabaseClient } from "../../api/supabaseClient";
const db = getSupabaseClient();
const { data } = await db.from("pipeline_runs")
  .select("id, logs")
  .eq("outcome_reason","model_output_invalid")
  .ilike("error_message","searchWithAnthropicNative%")
  .order("created_at",{ascending:false}).limit(1);
const logs:any = data?.[0]?.logs ?? {};
function walk(o:any, path:string, depth:number){
  if (depth>6 || o==null) return;
  if (typeof o!=="object") return;
  for (const k of Object.keys(o)){
    const np = path? `${path}.${k}`: k;
    if (/search/i.test(k) || /messages/i.test(k) || /userMessage|systemPrompt/i.test(k)) {
      const v=o[k];
      console.log(np, "=>", typeof v, typeof v==="string"? JSON.stringify(v.slice(0,60)) : Array.isArray(v)?`[len ${v.length}]`:Object.keys(v??{}).slice(0,6));
    }
    walk(o[k], np, depth+1);
  }
}
walk(logs,"",0);
process.exit(0);
