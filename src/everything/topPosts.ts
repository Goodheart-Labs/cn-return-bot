/**
 * Each followed creator's most popular posts of all time (GOO-81). The daily
 * walk offers these as extra enqueue candidates, behind the creator's recent
 * posts, so an evergreen hit gets checked on capacity that fresh posts leave
 * unused. Popularity is the platform's own signal: view count for a YouTube
 * video, like count for a Substack post.
 *
 * The lists live in the everything_top_posts cache table, because computing
 * one live costs a full channel listing or an archive API call. A creator's
 * all-time top list changes slowly, so each list is refreshed only once a
 * week, and each walk refreshes at most one creator so a single run never
 * pays for more than one listing. Only followed feeds get top posts;
 * visited-only creators earn a whole-history check by being followed.
 *
 * The whole feature is off until EVERYTHING_TOP_POSTS is set to "on".
 */

import { fetchAllTopPosts, fetchFollowedFeeds, replaceFeedTopPosts, type FollowedFeed, type TopPostRow } from "./db";
import { fetchTopArchivePosts } from "./sources/substack";
import { fetchChannelTopVideos, fetchVideoMeta } from "./sources/youtube";

export const TOP_POSTS_PER_FEED = 5;
const REFRESH_AGE_DAYS = 7;

export function topPostsEnabled(): boolean {
  return process.env.EVERYTHING_TOP_POSTS === "on";
}

async function fetchFreshTopList(feed: FollowedFeed): Promise<Omit<TopPostRow, "feed_url">[]> {
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
  return fetchChannelTopVideos(feed.feed_url, TOP_POSTS_PER_FEED).map((v, i) => ({
    source: "youtube" as const,
    url: v.url,
    title: v.title,
    // A channel listing carries no upload dates, so each top video costs one
    // metadata call here. That is five calls per channel per week. The ranking
    // needs the date: it is what keeps an old hit low in the recency rank.
    published_at: fetchVideoMeta(v.url).uploadDate ?? null,
    popularity: v.viewCount,
    rank: i + 1,
  }));
}

const isStale = (feed: FollowedFeed): boolean =>
  !feed.top_posts_refreshed_at ||
  Date.parse(feed.top_posts_refreshed_at) < Date.now() - REFRESH_AGE_DAYS * 24 * 3600_000;

/** Reads every cached top list and refreshes the stalest missing-or-expired
 *  one, at most one per call so a single run never pays for more than one
 *  listing. A failed refresh is logged and the walk goes on with the cached
 *  lists; the same feed is retried on the next run, so a lasting failure
 *  shows up in every run's log rather than killing the dispatch. Returns the
 *  up-to-date rows. */
export async function loadTopPosts(): Promise<TopPostRow[]> {
  const existing = await fetchAllTopPosts();
  const stale = (await fetchFollowedFeeds()).find(isStale);
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
    console.warn(`[top-posts] refresh failed for ${stale.feed_url}: ${err?.message}`);
    return existing;
  }
}
