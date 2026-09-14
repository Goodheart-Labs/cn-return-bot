import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const since = process.argv[2] ?? "2026-09-12T00:00:00Z";
const rows: any[] = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await db.from("pipeline_runs").select("*").gte("created_at", since).order("created_at").range(from, from + 499);
  if (error) throw error;
  rows.push(...data!);
  if (data!.length < 500) break;
}
console.log("rows", rows.length, "columns", Object.keys(rows[0] ?? {}).join(","));
const byDayStep: Record<string, { n: number; out: number; max: number; big: number }> = {};
const big: any[] = [];
for (const r of rows) {
  const entries: any[] = r.logs?.costs?.entries ?? [];
  const day = String(r.created_at).slice(0, 10);
  for (const e of entries) {
    const k = `${day} ${e.name}`;
    const s = (byDayStep[k] ??= { n: 0, out: 0, max: 0, big: 0 });
    s.n++; s.out += e.output_tokens ?? 0; s.max = Math.max(s.max, e.output_tokens ?? 0);
    if ((e.output_tokens ?? 0) > 15000) { s.big++; big.push({ day, tweet: r.tweet_id, step: e.name, out: e.output_tokens, cost: e.cost, created: r.created_at, finished: r.updated_at ?? r.finished_at ?? r.completed_at }); }
  }
}
console.log("\nday step: calls, mean output tokens, max output tokens, calls over 15k");
for (const [k, s] of Object.entries(byDayStep).sort()) console.log(k.padEnd(45), s.n, Math.round(s.out / s.n), s.max, s.big);
console.log("\nbig calls:"); for (const b of big) console.log(JSON.stringify(b));
