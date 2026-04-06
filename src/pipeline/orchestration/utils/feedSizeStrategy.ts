/**
 * Feed Size Strategy
 *
 * Builds the post selection query for the eligible posts API.
 * Hardcoded to small — we lost access to "large" feed (403) as of 2026-03-25.
 */

export type FeedSize = "small" | "large" | "xl";

export function buildPostSelection(_feedSize: FeedSize): { query: string; feedSize: FeedSize } {
  const feedSize: FeedSize = "small";
  return { query: `feed_size: ${feedSize}, feed_lang: en`, feedSize };
}
