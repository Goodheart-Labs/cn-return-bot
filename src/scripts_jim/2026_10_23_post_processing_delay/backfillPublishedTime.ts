/* Fills everything_items.published_time (migration 132) for the feed items the
 * walk enqueued before the column existed, so the dashboard's delay has data
 * at once. Substack times come from each feed's RSS, which holds only the
 * roughly 20 newest posts. Forum times come from the forum API, one call per
 * post, and YouTube times from the Data API, one quota unit per 50 videos.
 * An item whose time no source gives stays null and is left out of the delay.
 *
 *   bun run src/scripts_jim/2026_10_23_post_processing_delay/backfillPublishedTime.ts [--write]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../../everything-core/paging";
import { extractYoutubeVideoId } from "../../everything-core/pageUrls";
import { fetchForumPost } from "../../everything/sources/lesswrong";
import { fetchFeedPosts } from "../../everything/sources/substack";
import { fetchVideos } from "../../pipeline/media/youtubeDataApi";

const WRITE = process.argv.includes("--write");
const SINCE = "2026-09-01";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

type Row = { id: string; url: string; source: string; project: { feed_url: string | null } | null };
const items = await fetchAllRows<Row>(
  () => db.from("everything_items").select("id, url, source, project:everything_projects(feed_url)").lt("priority", 2).is("published_time", null).gte("created_at", SINCE),
  "id",
  { label: "items without published_time" },
);
console.log(`${items.length} feed items since ${SINCE} without an exact time`);

const times = new Map<string, string>();

const substackFeeds = new Set(items.filter((i) => i.source === "substack" && i.project?.feed_url).map((i) => i.project!.feed_url!));
for (const feed of substackFeeds) {
  try {
    for (const post of (await fetchFeedPosts(feed)).posts) times.set(post.url, post.publishedAt);
  } catch (err: any) {
    console.warn(`  ${feed}: ${err.message}`);
  }
}

const videoIds = new Map(items.filter((i) => i.source === "youtube").flatMap((i) => { const id = extractYoutubeVideoId(i.url); return id ? [[id, i.url] as const] : []; }));
for (const video of await fetchVideos([...videoIds.keys()])) times.set(videoIds.get(video.videoId)!, video.publishedTime);

for (const item of items.filter((i) => i.source === "lesswrong")) {
  try {
    const post = await fetchForumPost(item.url);
    if (post.publishedAt) times.set(item.url, post.publishedAt);
  } catch (err: any) {
    console.warn(`  ${item.url}: ${err.message}`);
  }
}

const updates = items.flatMap((i) => (times.has(i.url) ? [{ id: i.id, published_time: times.get(i.url)! }] : []));
console.log(`exact times found for ${updates.length} of ${items.length} items`);
if (!WRITE) {
  console.log("dry run, pass --write to save them");
  process.exit(0);
}
for (const { id, published_time } of updates) {
  const { error } = await db.from("everything_items").update({ published_time }).eq("id", id);
  if (error) throw error;
}
console.log(`saved ${updates.length}`);
