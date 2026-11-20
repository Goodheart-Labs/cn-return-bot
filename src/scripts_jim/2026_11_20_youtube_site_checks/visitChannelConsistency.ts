/** Over the last 30 days of YouTube watch-page visits: how many videos have
 *  visits saved under more than one channel (a stale reading after YouTube
 *  switched videos in place would cause that), and which videos have the
 *  most visits without a channel, to test those with readWatchPageChannel. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../../everything-core/paging";

const DAYS = 30;
const MS_PER_DAY = 86_400_000;
const SHOWN = 15;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const since = new Date(Date.now() - DAYS * MS_PER_DAY).toISOString();
const rows = await fetchAllRows<{ id: string; page_url: string; feed_url: string | null }>(
  () => db.from("everything_link_visits").select("id, page_url, feed_url").gte("visited_at", since).ilike("url", "%youtube.com/watch%"),
  "id",
);
const channelsByVideo = new Map<string, Map<string, number>>();
for (const row of rows) {
  const channels = channelsByVideo.get(row.page_url) ?? new Map<string, number>();
  const channel = row.feed_url ?? "(none)";
  channels.set(channel, (channels.get(channel) ?? 0) + 1);
  channelsByVideo.set(row.page_url, channels);
}
const videos = [...channelsByVideo];
const mixed = videos.filter(([, channels]) => [...channels.keys()].filter((c) => c !== "(none)").length > 1);
console.log(`${rows.length} visits on ${videos.length} videos. ${mixed.length} videos have visits under more than one channel.`);
for (const [video, channels] of mixed.slice(0, SHOWN)) console.log(`  ${video}  ${JSON.stringify(Object.fromEntries(channels))}`);
const withoutChannel = videos
  .map(([video, channels]) => ({ video, none: channels.get("(none)") ?? 0, withChannel: [...channels].filter(([c]) => c !== "(none)").reduce((sum, [, n]) => sum + n, 0) }))
  .filter((v) => v.none > 0)
  .sort((a, b) => b.none - a.none);
console.log(`${withoutChannel.length} videos have visits without a channel; ${withoutChannel.filter((v) => v.withChannel === 0).length} of them never got a channel. Top ones:`);
for (const v of withoutChannel.slice(0, SHOWN)) console.log(`  ${v.video}  without ${v.none}, with ${v.withChannel}`);
