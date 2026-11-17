import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-09-15";
const PAGE = 1000;

async function countByDay(table: string, column: string, extra?: (q: any) => any) {
  const counts = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    let query = db.from(table).select(column).gte(column, SINCE).order(column).range(from, from + PAGE - 1);
    if (extra) query = extra(query);
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data as any[]) {
      const day = String(row[column]).slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
  }
  return counts;
}

const [cn, x] = await Promise.all([
  countByDay("everything_notes", "created_at"),
  countByDay("notes", "submitted_at"),
]);
const days = [...new Set([...cn.keys(), ...x.keys()])].sort();
console.log("day        commonnotes  x");
for (const d of days) console.log(d, String(cn.get(d) ?? 0).padStart(10), String(x.get(d) ?? 0).padStart(5));
