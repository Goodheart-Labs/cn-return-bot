import { browser } from "#imports";
import type { FollowTarget } from "./followTarget";

// The URLs of the feeds the pipeline actually follows, from
// everything_followed_feeds. The background's sync writes the list next to the
// covered-pages cache, and the follow-button surfaces read it to decide whether
// an author is already followed. Ingested pages are no proxy for that: a reader
// can request a single page, and that must not hide the follow button for its
// author.
export const FOLLOWED_FEED_URLS_KEY = "cn:followedFeedUrls";

/** Null means the list has never been synced, which is the case on a fresh
 *  install. */
async function getFollowedFeedUrls(): Promise<string[] | null> {
  const stored = (await browser.storage.local.get(FOLLOWED_FEED_URLS_KEY))[FOLLOWED_FEED_URLS_KEY];
  return Array.isArray(stored) ? (stored as string[]) : null;
}

const normalizeFeedUrl = (url: string) => url.replace(/\/$/, "").toLowerCase();

/** Keeps a follow target only while its feed is not on the followed list, so
 *  the follow button never shows for an author we already follow. Both sides
 *  hold the feed in the form the pipeline stores, the *.substack.com root or
 *  the YouTube channel URL, so matching is a plain lookup apart from case and
 *  a trailing slash. Before the first sync the list is unknown and the target
 *  is kept; the pipeline resolves a repeat follow as already followed. */
export async function unlessFollowed(target: FollowTarget | null): Promise<FollowTarget | null> {
  if (!target) return null;
  const followed = await getFollowedFeedUrls();
  if (!followed) return target;
  const wanted = normalizeFeedUrl(target.feedUrl);
  return followed.some((url) => normalizeFeedUrl(url) === wanted) ? null : target;
}
