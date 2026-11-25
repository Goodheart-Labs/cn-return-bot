/**
 * One walk of the feed view recorder (GOO-834, GOO-880): read every page of
 * the small, large and XL tiers of X's eligible-posts feed, and turn the XL
 * posts into readings of their public counts. The tiers are nested, so XL
 * holds every post of the other two. Small and large are read only to learn
 * the smallest tier each post is in.
 *
 * Then the walk reads the XXL tier until it has made WALK_REQUEST_BUDGET
 * requests, for the Pangram pass (src/x-notes/pangram.ts). XXL is far bigger
 * than one walk can read: its first 120 pages held 11,670 posts on 2026-11-25,
 * and only about 16% of them were in XL. The posts that are only in XXL become
 * readings of their own, kept in memory and never stored.
 *
 * This module touches no database, so its rules can be tested with a faked
 * feed. main.ts stores what it returns.
 */

import { describeXError } from "../api/describeXError";
import type { FeedPage, Post } from "../api/fetchEligiblePosts";
import type { FeedSize } from "../pipeline/orchestration/utils/feedSizeStrategy";
import type { FeedReading } from "../pipeline/utils/viewsToCome";

export type RecordedTier = Exclude<FeedSize, "xxl">;

/** Smallest first. A walk reads them in this order. */
export const RECORDED_TIERS: readonly RecordedTier[] = ["small", "large", "xl"];

/** X allows 500 requests on the feed per 15 minutes. A walk starts every 10
 *  minutes, so one 15-minute window holds at most two walks. Jim set the
 *  budget on 2026-11-25: the three tiers take about 102 requests, and XXL
 *  takes the rest up to 250. Nothing else reads the first account's feed. */
export const WALK_REQUEST_BUDGET = 250;

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
  /** Distinct posts per tier. X can repeat a post across pages. */
  postsPerTier: Record<RecordedTier, number>;
  /** All requests of the walk, XXL included. */
  pages: number;
  rateRemaining: number | null;
  readings: Reading[];
  /** The posts of the XXL pages read that are not in XL. */
  xxlReadings: FeedReading[];
  xxlPages: number;
  /** Why the walk read no more of XXL. */
  xxlStop: string;
};

export type PageSource = (tier: FeedSize) => AsyncIterable<FeedPage>;

/** Walks the three tiers, then XXL. An X error ends the walk early. The
 *  result then keeps the readings it has and says why it stopped. XXL is read
 *  only after a complete walk of the three tiers, and its own end, for
 *  whatever reason, does not make the walk incomplete. */
export async function walkFeed(readPages: PageSource, now: () => Date = () => new Date()): Promise<WalkResult> {
  const startedAt = now();
  const smallestTier = new Map<string, RecordedTier>();
  const idsPerTier: Record<RecordedTier, Set<string>> = { small: new Set(), large: new Set(), xl: new Set() };
  const readings: Reading[] = [];
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
            if (idsPerTier[tier].has(post.id)) continue;
            idsPerTier[tier].add(post.id);
            if (tier === "xl") readings.push({ post, observedAt, tier: smallestTier.get(post.id)!, xlRank: readings.length + 1 });
          }
        }
      }
      return null;
    } catch (err) {
      return `X error: ${describeXError(err)}`;
    }
  })();

  const xxlReadings: FeedReading[] = [];
  let xxlPages = 0;
  const xxlStop = stopReason !== null ? "not read, because the walk stopped" : await (async (): Promise<string> => {
    if (pages >= WALK_REQUEST_BUDGET) return "the three tiers used the budget";
    const seen = new Set(idsPerTier.xl);
    try {
      for await (const page of readPages("xxl")) {
        pages++;
        xxlPages++;
        rateRemaining = page.rateRemaining;
        const observedAt = now();
        for (const post of page.posts) {
          if (seen.has(post.id)) continue;
          seen.add(post.id);
          xxlReadings.push({ post, observedAt });
        }
        if (page.isLastPage) return "end of the feed";
        if (pages >= WALK_REQUEST_BUDGET) return "budget";
        if (rateRemaining === 0) return "X has no requests left";
      }
      return "end of the feed";
    } catch (err) {
      return `X error: ${describeXError(err)}`;
    }
  })();

  const postsPerTier = { small: idsPerTier.small.size, large: idsPerTier.large.size, xl: idsPerTier.xl.size };
  return { startedAt, finishedAt: now(), stopReason, postsPerTier, pages, rateRemaining, readings, xxlReadings, xxlPages, xxlStop };
}
