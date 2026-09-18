/**
 * Each walked creator's most popular posts of all time (GOO-81). The daily
 * walk offers these as extra enqueue candidates, behind the creator's recent
 * posts, so an evergreen hit gets checked on capacity that fresh posts leave
 * unused. Popularity is the platform's own signal: view count for a YouTube
 * video, like count for a Substack post.
 *
 * The lists live in the everything_top_posts cache table, because computing
 * one live costs a full channel listing or an archive API call. A creator's
 * all-time top list changes slowly, so each list is refreshed only once a
 * week, and each walk refreshes at most one creator so a single run never
 * pays for more than one listing. Every creator the walk covers gets top
 * posts, whether they hold priority or are there on visits alone.
 */

import { fetchAllTopPosts, replaceFeedTopPosts, stampTopPostsAttempt, type TopPostRow } from "./db";
import type { RankedCreator } from "./creatorRanking";
import { fetchTopArchivePosts } from "./sources/substack";
import { fetchChannelTopVideos } from "./sources/youtubeDataApi";

const TOP_POSTS_PER_FEED = 5;
const REFRESH_AGE_DAYS = 7;

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
  const { videos } = await fetchChannelTopVideos(feed.feed_url, TOP_POSTS_PER_FEED);
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

/** A creator is refreshed when their list is a week old and no attempt was
 *  made in the last day. */
const isStale = (feed: RankedCreator): boolean =>
  olderThan(feed.top_posts_refreshed_at, REFRESH_AGE_DAYS * 24 * 3600_000) &&
  olderThan(feed.top_posts_attempted_at, RETRY_AFTER_HOURS * 3600_000);

/** Reads every cached top list and refreshes the stalest missing-or-expired
 *  one, at most one per call so a single run never pays for more than one
 *  listing. A failed refresh is logged and stamped as attempted, and the walk
 *  goes on with the cached lists; the same feed is retried the next day, so
 *  a lasting failure shows up once a day in the log rather than in every run
 *  and never kills the dispatch. Takes the
 *  creators the walk already ranked, so a cycle ranks once. Returns the
 *  up-to-date rows. */
export async function loadTopPosts(creators: RankedCreator[]): Promise<TopPostRow[]> {
  const existing = await fetchAllTopPosts();
  const stale = creators.find(isStale);
  if (!stale) return existing;
  try {
    const rows = await fetchFreshTopList(stale);
    await replaceFeedTopPosts(stale.feed_url, rows);
    console.log(`[top-posts] refreshed ${stale.feed_url}: ${rows.map((r) => `#${r.rank} ${r.popularity}`).join(", ")}`);
    // The fresh rows are mirrored in memory instead of re-reading the table.
    return [
      ...existing.filter((r) => r.feed_url !== stale.feed_url),
      ...rows.map((r) => ({ ...r, feed_url: stale.feed_url })),
    ];
  } catch (err: any) {
    console.warn(`[top-posts] refresh failed for ${stale.feed_url}, next try in ${RETRY_AFTER_HOURS}h: ${err?.message}`);
    await stampTopPostsAttempt(stale.feed_url);
    return existing;
  }
}
