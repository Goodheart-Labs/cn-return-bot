import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const since = new Date(Date.now() - 10 * 86400000).toISOString();

async function main() {
  // All failed runs whose error is the Gemini high-demand 503
  const { data, error } = await supabase.from("pipeline_runs")
    .select("created_at, bot_name, final_stage, outcome, error_message, media:logs->tweet->post->media, qmedia:logs->tweet->post->referenced_tweet_data->media")
    .gte("created_at", since)
    .or("error_message.ilike.%high demand%,error_message.ilike.%UNAVAILABLE%");
  if (error) throw error;
  const rows = data ?? [];
  console.log(`total high-demand/UNAVAILABLE failed-ish rows: ${rows.length}\n`);

  const by = (key: (r:any)=>string) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[key(r)] = (m[key(r)]||0)+1;
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  };
  console.log("by final_stage:", by(r=>r.final_stage));
  console.log("by bot_name:   ", by(r=>r.bot_name));
  console.log("by outcome:    ", by(r=>r.outcome));
  const hadMedia = rows.filter(r => (Array.isArray(r.media)&&r.media.length>0)||(Array.isArray(r.qmedia)&&r.qmedia.length>0)).length;
  console.log(`had media: ${hadMedia} / ${rows.length}`);
  console.log("\nsample full error messages:");
  for (const r of rows.slice(0,4)) console.log(`  [${r.final_stage}|${r.bot_name}] ${r.error_message?.slice(0,200)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
