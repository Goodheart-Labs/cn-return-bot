/**
 * Feed Size Strategy
 *
 * The feed size used for the eligible-posts fetch is a pseudo A/B test
 * (FEED_SIZE_TEST in abTests.ts) — currently 100% `small`. Switching to
 * a larger feed is a one-line flip of `PREFERRED_FEED_SIZE` in
 * generateCandidates.ts, which also has the `small` fallback on API
 * failure. This file just holds the post_selection builder.
 */

import type { FeedSize } from "../../ab-testing/botConfig";

export function buildPostSelection(feedSize: FeedSize): string {
  return `feed_size: ${feedSize}, feed_lang: en`;
}
