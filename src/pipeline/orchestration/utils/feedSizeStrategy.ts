/**
 * Feed Size Strategy
 *
 * The feed size used for the eligible-posts fetch is a pseudo A/B test
 * (FEED_SIZE_TEST in abTests.ts) — currently 100% `large` with `small` as a
 * runtime fallback if the API rejects `large`. The fetch logic lives in
 * generateCandidates.ts; this file just holds the post_selection builder.
 */

import type { FeedSize } from "../../ab-testing/botConfig";

export function buildPostSelection(feedSize: FeedSize): string {
  return `feed_size: ${feedSize}, feed_lang: en`;
}
