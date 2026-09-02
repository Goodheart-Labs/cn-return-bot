/** Lists a feed once and returns the source's display name. The follow-request
 *  consumer and the prioritize script both use this: the one listing proves the
 *  feed exists and is reachable from where the pipeline runs, before we commit
 *  to polling it, and the name it carries fills in the project's display name. */

import type { CanonicalFeed } from "../feedUrls";
import { fetchAuthorPosts } from "./lesswrong";
import { fetchFeedPosts } from "./substack";
import { fetchChannelVideos } from "./youtube";

export async function fetchFeedDisplayName(feed: CanonicalFeed): Promise<string | undefined> {
  if (feed.feed_type === "substack") return (await fetchFeedPosts(feed.feed_url)).title;
  if (feed.feed_type === "lesswrong") return (await fetchAuthorPosts(feed.feed_url, 1)).authorName;
  return fetchChannelVideos(feed.feed_url, 1).channelName;
}
