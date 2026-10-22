import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../everything-core/paging";
const db = getSupabaseClient();
const ev = await fetchAllRows<{ id: number; type: string; actor: string; at: string; note_id: string | null; data: unknown }>(
  () => db.from("everything_claude_events").select("id, type, actor, at, note_id, data"), "id");
const types = new Map<string, number>();
for (const e of ev) types.set(`${e.actor} ${e.type}`, (types.get(`${e.actor} ${e.type}`) ?? 0) + 1);
console.log(Object.fromEntries(types));
const hit = ev.filter((e) => e.note_id?.startsWith("81627bac"));
console.log(JSON.stringify(hit, null, 1).slice(0, 2000));
