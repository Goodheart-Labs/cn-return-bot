/**
 * One walk of the feed view recorder (GOO-834): read every page of the small,
 * large and XL tiers of X's eligible-posts feed, and turn the XL posts into
 * readings of their public counts. The tiers are nested, so XL holds every post
 * of the other two. Small and large are read only to learn the smallest tier
 * each post is in.
 *
 * This module touches no database, so its rules can be tested with a faked
 * feed. main.ts stores what it returns.
 */

import type { FeedPage, Post } from "../api/fetchEligiblePosts";
import type { FeedSize } from "../pipeline/orchestration/utils/feedSizeStrategy";

export type RecordedTier = Exclude<FeedSize, "xxl">;

/** Smallest first. A walk reads them in this order. */
export const RECORDED_TIERS: readonly RecordedTier[] = ["small", "large", "xl"];

/** X allows 500 requests per 15 minutes on the feed, and the X run draws on
 *  the same budget with about 100 requests per run. The walk stops when fewer
 *  than this many requests are left, so the X run always has room. */
export const RATE_RESERVE = 150;

export type Reading = {
  post: Post;
  observedAt: Date;
  tier: RecordedTier;
  /** The post's position in X's order of the XL list, starting at 1. */
  xlRank: number;
};

export type WalkResult = {
  startedAt: Date;
  finishedAt: Date;
  /** Null when the walk read all three tiers to the end. */
  stopReason: string | null;
  postsPerTier: Record<RecordedTier, number>;
  pages: number;
  rateRemaining: number | null;
  readings: Reading[];
};

export type PageSource = (tier: RecordedTier) => AsyncIterable<FeedPage>;

/** Walks the three tiers. An X error or the rate reserve ends the walk early.
 *  The result then keeps the readings it has and says why it stopped. */
export async function walkFeed(readPages: PageSource, now: () => Date = () => new Date()): Promise<WalkResult> {
  const startedAt = now();
  const smallestTier = new Map<string, RecordedTier>();
  const postsPerTier: Record<RecordedTier, number> = { small: 0, large: 0, xl: 0 };
  const readings: Reading[] = [];
  const readIds = new Set<string>();
  let pages = 0;
  let rateRemaining: number | null = null;

  const stopReason = await (async (): Promise<string | null> => {
    try {
      for (const tier of RECORDED_TIERS) {
        for await (const page of readPages(tier)) {
          pages++;
          rateRemaining = page.rateRemaining;
          const observedAt = now();
          for (const post of page.posts) {
            if (!smallestTier.has(post.id)) smallestTier.set(post.id, tier);
            // X can repeat a post across pages. The first sighting counts.
            if (tier === "xl" && !readIds.has(post.id)) {
              readIds.add(post.id);
              readings.push({ post, observedAt, tier: smallestTier.get(post.id)!, xlRank: readings.length + 1 });
            }
          }
          postsPerTier[tier] += page.posts.length;
          const walkIsOver = page.isLastPage && tier === RECORDED_TIERS.at(-1);
          if (!walkIsOver && rateRemaining !== null && rateRemaining < RATE_RESERVE) {
            return `rate reserve: X said ${rateRemaining} requests are left, during the ${tier} tier`;
          }
        }
      }
      return null;
    } catch (err) {
      return `X error: ${describeXError(err)}`;
    }
  })();

  return { startedAt, finishedAt: now(), stopReason, postsPerTier, pages, rateRemaining, readings };
}

/** axios puts X's own explanation in the response body, which its message
 *  leaves out. */
function describeXError(err: unknown): string {
  const response = (err as { response?: { status?: number; data?: unknown } }).response;
  if (response) return `HTTP ${response.status} ${JSON.stringify(response.data).slice(0, 300)}`;
  return err instanceof Error ? err.message : String(err);
}
