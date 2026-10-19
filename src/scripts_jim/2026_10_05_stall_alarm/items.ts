/** Dumps every everything_items row processed in the last 16 days, to see what
 *  the three incidents in GOO-359 look like in the data. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const LOOKBACK_DAYS = 16;
const PAGE_SIZE = 1000;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
const rows: any[] = [];
for (let from = 0; ; from += PAGE_SIZE) {
  const { data, error } = await db
    .from("everything_items")
    .select("id, status, error, skip_reason, processed_at, started_at, created_at, priority, source, retries, checked_scope, url")
    .gte("processed_at", since)
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  rows.push(...data);
  if (data.length < PAGE_SIZE) break;
}
writeFileSync(new URL("./items.json", import.meta.url), JSON.stringify(rows, null, 1));
console.log(`${rows.length} items processed since ${since}`);
