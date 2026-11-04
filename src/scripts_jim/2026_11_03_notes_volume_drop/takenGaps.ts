import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/** For each day, how many posts Claude took, split into reader requests and
 *  feed posts by the item's queue priority, and the median gap between two
 *  feed posts. Comparing the gap with the pacing interval of replayPacing.ts
 *  says whether the pacing or something else held the posts back. */
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-10-25";
const REQUESTED_TIER = 2;

const { data: events, error } = await db.from("everything_claude_events")
  .select("at, item_id, item:everything_items(priority)")
  .eq("type", "item_taken").gte("at", SINCE).order("at").limit(5000);
if (error) throw error;

const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : NaN;
};

for (const [day, rows] of Object.entries(Object.groupBy(events as any[], (e) => e.at.slice(0, 10)))) {
  const requested = rows!.filter((e) => e.item?.priority === REQUESTED_TIER);
  const feed = rows!.filter((e) => e.item?.priority !== REQUESTED_TIER);
  const distinctFeed = new Set(feed.map((e) => e.item_id)).size;
  const gapsMinutes = feed.slice(1).map((e, i) => (Date.parse(e.at) - Date.parse(feed[i]!.at)) / 60_000);
  console.log(`${day}: ${rows!.length} taken, ${requested.length} reader requests, ${feed.length} feed takes on ${distinctFeed} feed posts, median gap ${median(gapsMinutes).toFixed(0)} min`);
}
