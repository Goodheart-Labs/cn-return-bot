/**
 * Feed Size Strategy
 *
 * Shared types and request builder for X's eligible-posts feed tiers.
 */

/** Feed sizes accepted by X's eligible-posts API. */
export type FeedSize = "small" | "large" | "xl" | "xxl";

export function buildPostSelection(feedSize: FeedSize): string {
  return `feed_size: ${feedSize}, feed_lang: en`;
}
