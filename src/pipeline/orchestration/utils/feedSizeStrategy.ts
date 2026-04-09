/**
 * Feed Size Strategy
 *
 * Builds the post selection query for the eligible posts API.
 * Hardcoded to small — we lost access to "large" feed (403) as of 2026-03-25.
 */

export type FeedSize = "small" | "large" | "xl";

export function buildPostSelection(_feedSize: FeedSize): string {
  return `feed_size: small, feed_lang: en`;
}
