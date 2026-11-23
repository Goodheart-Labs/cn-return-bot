import { describe, expect, test } from "bun:test";
import type { Post } from "../api/fetchEligiblePosts";
import { readingsOf, scoreWalk } from "../feed-views/score";
import type { Reading, RecordedTier, WalkResult } from "../feed-views/walk";
import { flagsThenEval } from "../pipeline/ranking/scorers";
import { effectiveHoursLeft, VIEWS_TO_COME_FLOOR } from "../pipeline/utils/viewsToCome";
import { eligiblePosts, pickPosts } from "./pick";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const TEN_MINUTES = 10 * 60_000;

function post(id: string, impressions: number, opts: { ageH?: number; sensitive?: boolean } = {}): Post {
  return {
    id, author_id: "a", text: "", media: [],
    created_at: new Date(NOW - (opts.ageH ?? 6) * 3_600_000).toISOString(),
    public_metrics: { impression_count: impressions },
    raw: { possibly_sensitive: opts.sensitive ?? false, includes: { referenced_tweets: [] } },
  } as unknown as Post;
}

function walk(at: number, posts: [Post, RecordedTier][]): WalkResult {
  const readings: Reading[] = posts.map(([p, tier], i) => ({ post: p, observedAt: new Date(at), tier, xlRank: i + 1 }));
  return { startedAt: new Date(at), finishedAt: new Date(at), stopReason: null, postsPerTier: { small: 0, large: 0, xl: 0 }, pages: 1, rateRemaining: 400, readings };
}

/** The views a post at 6 hours must gain in 10 minutes to be predicted `to come` views. */
const gainFor = (toCome: number) => Math.ceil(toCome / 6 / effectiveHoursLeft(6));

describe("scoring and picking a walk", () => {
  // Each post's count 10 minutes ago, then its count now.
  const posts: [string, RecordedTier, number, number, { ageH?: number; sensitive?: boolean }?][] = [
    ["small-best", "small", 100_000, 100_000 + gainFor(2 * VIEWS_TO_COME_FLOOR)],
    ["small-ok", "small", 100_000, 100_000 + gainFor(1.1 * VIEWS_TO_COME_FLOOR)],
    ["large-huge", "large", 100_000, 100_000 + gainFor(50 * VIEWS_TO_COME_FLOOR)],
    ["xl-slow", "xl", 100_000, 100_000 + gainFor(0.5 * VIEWS_TO_COME_FLOOR)],
    ["xl-past-48h", "xl", 100_000, 100_000 + gainFor(50 * VIEWS_TO_COME_FLOOR), { ageH: 49 }],
    ["xl-day-old", "xl", 100_000, 100_000 + gainFor(50 * VIEWS_TO_COME_FLOOR), { ageH: 30 }],
    ["xl-sensitive", "xl", 100_000, 100_000 + gainFor(50 * VIEWS_TO_COME_FLOOR), { sensitive: true }],
  ];
  const before = walk(NOW - TEN_MINUTES, posts.map(([id, tier, then, , opts]) => [post(id, then, opts), tier]));
  const now = walk(NOW, [...posts.map(([id, tier, , count, opts]) => [post(id, count, opts), tier] as [Post, RecordedTier]), [post("xl-new", 900_000), "xl"]]);
  const scores = scoreWalk(now, readingsOf(before));
  const eligible = eligiblePosts(now.readings, scores);

  test("scores a post from its gain since the walk before, and only then", () => {
    expect(scores.get("small-best")).toBeGreaterThan(2 * VIEWS_TO_COME_FLOOR * 0.99);
    expect(scores.get("xl-new")).toBeNull();
  });

  test("leaves out posts below the floor, past 48 hours, sensitive, or without a score, but not older ones above the floor", () => {
    expect(eligible.map((s) => s.post.id).sort()).toEqual(["large-huge", "small-best", "small-ok", "xl-day-old"]);
  });

  test("picks the ladder's order within the budget and skips posts handled before", () => {
    expect(pickPosts(eligible, new Set(), 2, null, NOW).map((s) => s.post.id)).toEqual(["small-best", "small-ok"]);
    expect(pickPosts(eligible, new Set(["small-best"]), 5, null, NOW).map((s) => s.post.id)).toEqual(["small-ok", "large-huge", "xl-day-old"]);
    expect(pickPosts(eligible, new Set(), 0, null, NOW)).toEqual([]);
  });

  test("a ranking scorer orders across the tiers", () => {
    expect(pickPosts(eligible, new Set(), 3, flagsThenEval, NOW)[0]!.post.id).toBe("large-huge");
  });
});
