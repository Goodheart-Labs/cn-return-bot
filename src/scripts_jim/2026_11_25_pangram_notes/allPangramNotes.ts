/** Lists every note in the notes table whose text names Pangram, whatever bot wrote it (GOO-880). */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await db
  .from("notes")
  .select("note_id, tweet_id, cn_status, submitted_at, x_account, note_text")
  .ilike("note_text", "%pangram%")
  .order("submitted_at");
if (error) throw error;
const byDay: Record<string, number> = {};
for (const n of data) byDay[`${n.submitted_at?.slice(0, 10)} ${n.cn_status}`] = (byDay[`${n.submitted_at?.slice(0, 10)} ${n.cn_status}`] ?? 0) + 1;
console.log(data.length, byDay);
const { data: runs, error: rErr } = await db.from("pipeline_runs").select("bot_name, outcome").ilike("note_text", "%pangram%");
if (rErr) throw rErr;
const byBot: Record<string, number> = {};
for (const r of runs) byBot[`${r.bot_name} ${r.outcome}`] = (byBot[`${r.bot_name} ${r.outcome}`] ?? 0) + 1;
console.log(byBot);
