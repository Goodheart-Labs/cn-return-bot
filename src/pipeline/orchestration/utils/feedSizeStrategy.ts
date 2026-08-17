/**
 * Feed Size Strategy
 *
 * This module holds the shared type and the request builder for the feed tiers
 * of X's eligible-posts API.
 */

/** These are the feed sizes X's eligible-posts API accepts. */
export type FeedSize = "small" | "large" | "xl" | "xxl";

export function buildPostSelection(feedSize: FeedSize): string {
  return `feed_size: ${feedSize}, feed_lang: en`;
}
