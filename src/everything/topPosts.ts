/**
 * Each walked creator's most popular posts of all time (GOO-81). The daily
 * walk offers these as extra enqueue candidates, behind the creator's recent
 * posts, so an evergreen hit gets checked on capacity that fresh posts leave
 * unused. Popularity is the platform's own signal: view count for a YouTube
 * video, like count for a Substack post.
 *
 * The lists live in the everything_top_posts cache table, because computing
 * one live costs a full channel scan or an archive API call. A YouTube scan
 * of 3000 videos costs about 120 of the Data API's 10,000 daily quota units.
 * A creator's all-time top list barely changes, so each list is refreshed
 * only every 60 days (Jim, GOO-225; it was weekly), and each walk refreshes
 * at most one creator so a single run never pays for more than one scan.
 * Every creator the walk reaches gets top posts, whether they hold priority
 * or are there on visits alone.
 */

import { replaceFeedTopPosts, stampTopPostsAttempt, type TopPostRow } from "./db";
import type { RankedCreator } from "./creatorRanking";
import { fetchTopArchivePosts } from "./sources/substack";
import { fetchChannelTopVideos } from "./sources/youtubeDataApi";
import { youtubeChannelId } from "./youtubeChannels";

const TOP_POSTS_PER_FEED = 5;
const REFRESH_AGE_DAYS = 60;

/** How long a creator whose refresh failed waits before it is tried again.
 *  Without this a failing creator was the stalest one in every run and paid
 *  for the same failure all day (28 times on 2026-09-16, GOO-169). */
const RETRY_AFTER_HOURS = 24;

async function fetchFreshTopList(feed: RankedCreator): Promise<Omit<TopPostRow, "feed_url">[]> {
  // A forum author has no all-time list yet: LessWrong's API exposes karma, but
  // nothing reads it here, so the creator's stamp is set with an empty list and
  // only their new posts are walked. Returning nothing rather than throwing is
  // what keeps them from being retried on every run.
  if (feed.feed_type === "lesswrong") return [];
  if (feed.feed_type === "substack") {
    return (await fetchTopArchivePosts(feed.feed_url, TOP_POSTS_PER_FEED)).map((p, i) => ({
      source: "substack" as const,
      url: p.url,
      title: p.title,
      published_at: p.postDate,
      popularity: p.likes,
      rank: i + 1,
    }));
  }
  const videos = await fetchChannelTopVideos(await youtubeChannelId(feed.feed_url), TOP_POSTS_PER_FEED);
  return videos.map((v, i) => ({
    source: "youtube" as const,
    url: v.url,
    title: v.title,
    published_at: v.publishedAt,
    popularity: v.viewCount,
    rank: i + 1,
  }));
}

const olderThan = (stamp: string | null, ms: number): boolean => !stamp || Date.parse(stamp) < Date.now() - ms;

/** A creator is refreshed when their list is REFRESH_AGE_DAYS old and no
 *  attempt was made in the last day. */
const isStale = (feed: RankedCreator): boolean =>
  olderThan(feed.top_posts_refreshed_at, REFRESH_AGE_DAYS * 24 * 3600_000) &&
  olderThan(feed.top_posts_attempted_at, RETRY_AFTER_HOURS * 3600_000);

/** Refreshes the top list of the first of `creators` whose list is missing or
 *  expired, at most one per call so a single run never pays for more than one
 *  scan. A failed refresh is logged and stamped as attempted, and the same
 *  feed is retried the next day, so a lasting failure shows up once a day in
 *  the log rather than in every run and never kills the dispatch. */
export async function refreshOneStaleTopList(creators: RankedCreator[]): Promise<void> {
  const stale = creators.find(isStale);
  if (!stale) return;
  try {
    const rows = await fetchFreshTopList(stale);
    await replaceFeedTopPosts(stale.feed_url, rows);
    console.log(`[top-posts] refreshed ${stale.feed_url}: ${rows.map((r) => `#${r.rank} ${r.popularity}`).join(", ")}`);
  } catch (err: any) {
    console.warn(`[top-posts] refresh failed for ${stale.feed_url}, next try in ${RETRY_AFTER_HOURS}h: ${err?.message}`);
    await stampTopPostsAttempt(stale.feed_url);
  }
}
