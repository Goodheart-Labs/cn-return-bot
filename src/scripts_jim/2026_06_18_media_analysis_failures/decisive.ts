import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const MS = 86400000;
const len = (v:unknown)=>Array.isArray(v)?v.length:0;

async function fetchDay(start:number){
  const s=new Date(start).toISOString(), e=new Date(start+MS).toISOString();
  const { data, error } = await supabase.from("pipeline_runs")
    .select("outcome, media:logs->tweet->post->media, qmedia:logs->tweet->post->referenced_tweet_data->media, geminiRes:logs->media->gemini, reachedSearch:logs->note_writer_steps->search")
    .gte("created_at",s).lt("created_at",e).limit(5000);
  if(error) throw error; return data??[];
}
async function main(){
  const today=Math.floor(Date.now()/MS)*MS;
  console.log("\nDay         | hadMedia & reachedSearch | media.gemini present | media.gemini MISSING (swallowed fail)");
  console.log("------------|--------------------------|----------------------|--------------------------------------");
  let tDen=0,tOk=0,tMiss=0;
  for(let i=9;i>=0;i--){
    const rows=await fetchDay(today-i*MS);
    let den=0,ok=0,miss=0;
    for(const r of rows as any[]){
      const had=len(r.media)>0||len(r.qmedia)>0;
      const reached=r.reachedSearch!=null;        // createBotInput finished, media was attempted
      if(had&&reached){den++; if(r.geminiRes!=null) ok++; else miss++;}
    }
    tDen+=den;tOk+=ok;tMiss+=miss;
    console.log(`${new Date(today-i*MS).toISOString().slice(0,10)}  | ${String(den).padStart(24)} | ${String(ok).padStart(20)} | ${String(miss).padStart(36)}`);
  }
  console.log("------------|--------------------------|----------------------|--------------------------------------");
  console.log(`TOTAL       | ${String(tDen).padStart(24)} | ${String(tOk).padStart(20)} | ${String(tMiss).padStart(36)}`);
}
main().catch(e=>{console.error(e);process.exit(1);});
