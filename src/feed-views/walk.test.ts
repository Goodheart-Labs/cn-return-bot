import { describe, expect, test } from "bun:test";
import type { FeedPage, Post } from "../api/fetchEligiblePosts";
import { RATE_RESERVE, type RecordedTier, walkFeed } from "./walk";

function post(id: string, impressions = 100): Post {
  return { id, author_id: "a", created_at: "2026-11-20T00:00:00Z", text: "", media: [], public_metrics: { impression_count: impressions } };
}

/** A fake feed: each tier is a list of pages, each page a list of post ids. It
 *  records which tiers were asked for which pages, so a test can see that the
 *  walk made no request after it stopped. */
function fakeFeed(tiers: Record<RecordedTier, string[][]>, rateRemainingAfter: (requestNumber: number) => number = () => 400) {
  const requests: string[] = [];
  const readPages = async function* (tier: RecordedTier): AsyncGenerator<FeedPage> {
    const pages = tiers[tier];
    for (const [i, ids] of pages.entries()) {
      requests.push(`${tier}:${i}`);
      yield { posts: ids.map((id) => post(id)), rateRemaining: rateRemainingAfter(requests.length), isLastPage: i === pages.length - 1 };
    }
  };
  return { readPages, requests };
}

describe("a walk of the feed", () => {
  test("records each XL post once, with the smallest tier it was in and its place in X's order", async () => {
    const { readPages } = fakeFeed({ small: [["s"]], large: [["s", "l"]], xl: [["l", "x"], ["s", "x"]] });
    const walk = await walkFeed(readPages);
    expect(walk.stopReason).toBeNull();
    expect(walk.readings.map((r) => [r.post.id, r.tier, r.xlRank])).toEqual([
      ["l", "large", 1],
      ["x", "xl", 2],
      ["s", "small", 3],
    ]);
    expect(walk.postsPerTier).toEqual({ small: 1, large: 2, xl: 4 });
    expect(walk.pages).toBe(4);
  });

  test("stops before the next request once fewer than the reserve are left", async () => {
    const { readPages, requests } = fakeFeed(
      { small: [["a"]], large: [["a", "b"], ["c"]], xl: [["a", "b", "c"]] },
      (n) => (n >= 2 ? RATE_RESERVE - 1 : 400),
    );
    const walk = await walkFeed(readPages);
    expect(requests).toEqual(["small:0", "large:0"]);
    expect(walk.stopReason).toContain("rate reserve");
    expect(walk.readings).toEqual([]);
  });

  test("a low budget after the very last page still counts as a complete walk", async () => {
    const { readPages } = fakeFeed({ small: [["a"]], large: [["a"]], xl: [["a"]] }, (n) => (n === 3 ? 0 : 400));
    expect((await walkFeed(readPages)).stopReason).toBeNull();
  });

  test("an X error ends the walk and keeps the readings it already has", async () => {
    const readPages = async function* (tier: RecordedTier): AsyncGenerator<FeedPage> {
      if (tier !== "xl") return;
      yield { posts: [post("a")], rateRemaining: 400, isLastPage: false };
      throw Object.assign(new Error("Request failed"), { response: { status: 503, data: { title: "Service Unavailable" } } });
    };
    const walk = await walkFeed(readPages);
    expect(walk.stopReason).toBe('X error: HTTP 503 {"title":"Service Unavailable"}');
    expect(walk.readings.map((r) => r.post.id)).toEqual(["a"]);
  });
});
