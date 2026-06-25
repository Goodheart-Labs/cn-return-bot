import { getSupabaseClient } from "../../api/supabaseClient";
const supabase = getSupabaseClient();
const MS = 86400000;

interface Item { type?: string; url?: string; description?: { description?: string; ocrText?: string } }
const items = (v: unknown): Item[] => (Array.isArray(v) ? (v as Item[]) : []);
const failed = (it: Item) => (it.description?.description ?? "") === "";

async function fetchDay(start: number) {
  const s = new Date(start).toISOString(), e = new Date(start + MS).toISOString();
  const { data, error } = await supabase.from("pipeline_runs")
    .select("tw:logs->media->gemini->tweetMedia, qt:logs->media->gemini->quotedTweetMedia")
    .gte("created_at", s).lt("created_at", e).limit(5000);
  if (error) throw error; return data ?? [];
}

async function main() {
  const today = Math.floor(Date.now() / MS) * MS;
  console.log("\nDay         | runs w/ media items | media items | FAILED items (empty desc) | runs w/ >=1 fail | item-fail %");
  console.log("------------|---------------------|-------------|----------------------------|------------------|------------");
  let tRunsMedia=0, tItems=0, tFail=0, tRunsFail=0;
  for (let i=9;i>=0;i--){
    const rows = await fetchDay(today - i*MS);
    let runsMedia=0, nItems=0, nFail=0, runsFail=0;
    for (const r of rows as any[]) {
      const all = [...items(r.tw), ...items(r.qt)];
      if (all.length===0) continue;
      runsMedia++; nItems += all.length;
      const f = all.filter(failed).length;
      nFail += f; if (f>0) runsFail++;
    }
    tRunsMedia+=runsMedia; tItems+=nItems; tFail+=nFail; tRunsFail+=runsFail;
    const pct = nItems ? ((nFail/nItems)*100).toFixed(1) : "—";
    console.log(`${new Date(today-i*MS).toISOString().slice(0,10)}  | ${String(runsMedia).padStart(19)} | ${String(nItems).padStart(11)} | ${String(nFail).padStart(26)} | ${String(runsFail).padStart(16)} | ${pct.padStart(10)}`);
  }
  console.log("------------|---------------------|-------------|----------------------------|------------------|------------");
  const tp = tItems ? ((tFail/tItems)*100).toFixed(1) : "—";
  console.log(`TOTAL       | ${String(tRunsMedia).padStart(19)} | ${String(tItems).padStart(11)} | ${String(tFail).padStart(26)} | ${String(tRunsFail).padStart(16)} | ${tp.padStart(10)}`);
}
main().catch(e=>{console.error(e);process.exit(1);});
