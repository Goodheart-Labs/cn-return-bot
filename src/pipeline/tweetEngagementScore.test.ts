import { describe, test, expect } from "bun:test";
import { tweetEngagementScore, sortByEngagement } from "./tweetEngagementScore";

describe("tweetEngagementScore", () => {
  test("returns 0 for undefined metrics", () => {
    expect(tweetEngagementScore(undefined)).toBe(0);
  });

  test("returns 0 for zero impressions", () => {
    expect(tweetEngagementScore({ impression_count: 0 })).toBe(0);
  });

  test("returns 0 for negative impressions", () => {
    expect(tweetEngagementScore({ impression_count: -1 })).toBe(0);
  });

  test("scores 100K impressions around 5.0", () => {
    const score = tweetEngagementScore({ impression_count: 100_000 });
    expect(score).toBeGreaterThan(4.9);
    expect(score).toBeLessThan(5.1);
  });

  test("scores 1M impressions around 6.0", () => {
    const score = tweetEngagementScore({ impression_count: 1_000_000 });
    expect(score).toBeGreaterThan(5.9);
    expect(score).toBeLessThan(6.1);
  });

  test("scores 10M impressions around 7.0", () => {
    const score = tweetEngagementScore({ impression_count: 10_000_000 });
    expect(score).toBeGreaterThan(6.9);
    expect(score).toBeLessThan(7.1);
  });

  test("10M impressions scores higher than 100K", () => {
    const high = tweetEngagementScore({ impression_count: 10_000_000 });
    const low = tweetEngagementScore({ impression_count: 100_000 });
    expect(high).toBeGreaterThan(low);
  });

  test("high engagement rate adds bonus", () => {
    const base = tweetEngagementScore({ impression_count: 1_000_000 });
    const withEngagement = tweetEngagementScore({
      impression_count: 1_000_000,
      like_count: 50_000,
      retweet_count: 10_000,
      quote_count: 5_000,
    });
    expect(withEngagement).toBeGreaterThan(base);
  });

  test("engagement bonus is capped at 1.0", () => {
    // Extreme engagement: 100% engagement rate -> bonus = min(1.0*2, 1.0) = 1.0
    const extreme = tweetEngagementScore({
      impression_count: 1_000,
      like_count: 1_000,
      retweet_count: 500,
    });
    const base = tweetEngagementScore({ impression_count: 1_000 });
    expect(extreme - base).toBeLessThanOrEqual(1.0);
  });
});

describe("sortByEngagement", () => {
  test("sorts posts by engagement score descending", () => {
    const posts = [
      { id: "1", public_metrics: { impression_count: 100_000 } },
      { id: "3", public_metrics: { impression_count: 10_000_000 } },
      { id: "2", public_metrics: { impression_count: 1_000_000 } },
    ];
    sortByEngagement(posts);
    expect(posts[0].id).toBe("3"); // 10M
    expect(posts[1].id).toBe("2"); // 1M
    expect(posts[2].id).toBe("1"); // 100K
  });

  test("uses recency as tiebreaker (higher ID = newer = first)", () => {
    const posts = [
      { id: "100", public_metrics: { impression_count: 1_000_000 } },
      { id: "200", public_metrics: { impression_count: 1_000_000 } },
    ];
    sortByEngagement(posts);
    expect(posts[0].id).toBe("200"); // newer
    expect(posts[1].id).toBe("100");
  });

  test("posts with no metrics sort last", () => {
    const posts = [
      { id: "1", public_metrics: undefined },
      { id: "2", public_metrics: { impression_count: 500_000 } },
    ];
    sortByEngagement(posts);
    expect(posts[0].id).toBe("2");
    expect(posts[1].id).toBe("1");
  });
});
