/** Counts, per day of the last 30, the YouTube watch-page visits the extension
 *  saved, and how many of them lack the creator's feed address. A rise in the
 *  share without one dates YouTube's collaboration owner box. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../../everything-core/paging";

const DAYS = 30;
const MS_PER_DAY = 86_400_000;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const since = new Date(Date.now() - DAYS * MS_PER_DAY).toISOString();
const rows = await fetchAllRows<{ id: string; url: string; feed_url: string | null; visited_at: string }>(() =>
  db.from("everything_link_visits").select("id, url, feed_url, visited_at").gte("visited_at", since).ilike("url", "%youtube.com/watch%"),
  "id",
);
const byDay = new Map<string, { total: number; withoutChannel: number }>();
for (const row of rows) {
  const day = row.visited_at.slice(0, 10);
  const counts = byDay.get(day) ?? { total: 0, withoutChannel: 0 };
  counts.total++;
  if (!row.feed_url) counts.withoutChannel++;
  byDay.set(day, counts);
}
console.log(`YouTube watch-page visits from ${since.slice(0, 10)} to now, per UTC day:`);
for (const [day, { total, withoutChannel }] of [...byDay].sort()) console.log(`${day}  ${String(total).padStart(4)} visits  ${String(withoutChannel).padStart(4)} without a channel (${Math.round((100 * withoutChannel) / total)}%)`);
