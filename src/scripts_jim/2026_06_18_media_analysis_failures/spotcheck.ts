import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const since = new Date(Date.now() - 10 * 86400000).toISOString();
interface Item { type?:string; url?:string; description?:{description?:string;ocrText?:string}; transcription?:string }
async function main() {
  const { data, error } = await supabase.from("pipeline_runs")
    .select("created_at, tw:logs->media->gemini->tweetMedia, qt:logs->media->gemini->quotedTweetMedia")
    .gte("created_at", since).limit(5000);
  if (error) throw error;
  let emptyByType:Record<string,number>={}, emptyNoTranscript=0, emptyWithTranscript=0;
  let okByType:Record<string,number>={}, okDescLens:number[]=[];
  const samples:any[]=[];
  for (const r of data as any[]) {
    for (const it of ([...(r.tw??[]),...(r.qt??[])] as Item[])) {
      const empty=(it.description?.description??"")==="";
      const t=it.type??"?";
      if (empty){ emptyByType[t]=(emptyByType[t]||0)+1; if((it.transcription??"")==="") emptyNoTranscript++; else emptyWithTranscript++;
        if(samples.length<5) samples.push({t,hasTranscript:(it.transcription??"")!=="", ocr:it.description?.ocrText??"", url:(it.url??"").slice(0,60)});}
      else { okByType[t]=(okByType[t]||0)+1; okDescLens.push((it.description?.description??"").length); }
    }
  }
  console.log("EMPTY-desc items by type:", emptyByType);
  console.log(`  empty + NO transcription (video catch signature): ${emptyNoTranscript}`);
  console.log(`  empty + has transcription: ${emptyWithTranscript}`);
  console.log("NON-empty items by type:", okByType);
  okDescLens.sort((a,b)=>a-b);
  console.log(`  non-empty description length: min=${okDescLens[0]} median=${okDescLens[Math.floor(okDescLens.length/2)]} (so successes are never empty)`);
  console.log("samples of empty items:", JSON.stringify(samples,null,1));
}
main().catch(e=>{console.error(e);process.exit(1);});
