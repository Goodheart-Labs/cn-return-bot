import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const since = new Date(Date.now() - 10 * 86400000).toISOString();
async function main() {
  const { data } = await supabase.from("pipeline_runs")
    .select("created_at, mediaTweet:logs->media->gemini->tweetMedia, searchStep:logs->note_writer_steps->search, searchModel:logs->note_writer_steps->search->messages->0->model")
    .eq("outcome","failed").ilike("error_message","%high demand%").gte("created_at", since).limit(60);
  let mediaOk=0, searchHadMsg0=0, searchHadMsg1=0;
  const models: Record<string,number> = {};
  for (const r of data ?? []) {
    if (Array.isArray(r.mediaTweet) && r.mediaTweet.length>0) mediaOk++;
    const s = r.searchStep as any;
    const msgs = s?.messages;
    if (msgs && msgs["0"] !== undefined) searchHadMsg0++;
    if (msgs && msgs["1"] !== undefined) searchHadMsg1++;
    const m = (r.searchModel as string) ?? "(none)"; models[m]=(models[m]||0)+1;
  }
  const n=(data??[]).length;
  console.log(`failed-503 runs sampled: ${n}`);
  console.log(`  media analysis produced descriptions (succeeded): ${mediaOk}/${n}`);
  console.log(`  search step logged its request (messages.0): ${searchHadMsg0}/${n}`);
  console.log(`  search step logged a response (messages.1, i.e. succeeded): ${searchHadMsg1}/${n}`);
  console.log(`  search model used:`, models);
}
main().catch(e=>{console.error(e);process.exit(1);});
