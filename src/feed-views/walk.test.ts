import { describe, expect, test } from "bun:test";
import type { FeedPage, Post } from "../api/fetchEligiblePosts";
import type { FeedSize } from "../pipeline/orchestration/utils/feedSizeStrategy";
import { WALK_REQUEST_BUDGET, walkFeed } from "./walk";

function post(id: string, impressions = 100): Post {
  return { id, author_id: "a", created_at: "2026-11-20T00:00:00Z", text: "", media: [], public_metrics: { impression_count: impressions } };
}

/** A fake feed: each tier is a list of pages, each page a list of post ids. It
 *  records which tiers were asked for which pages, so a test can see that the
 *  walk made no request after it stopped. */
function fakeFeed(tiers: Partial<Record<FeedSize, string[][]>>, rateRemainingAfter: (requestNumber: number) => number = () => 400) {
  const requests: string[] = [];
  const readPages = async function* (tier: FeedSize): AsyncGenerator<FeedPage> {
    const pages = tiers[tier] ?? [];
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
    expect(walk.postsPerTier).toEqual({ small: 1, large: 2, xl: 3 });
    expect(walk.pages).toBe(4);
  });

  test("then reads XXL and keeps only the posts that are not in XL", async () => {
    const { readPages } = fakeFeed({ small: [["s"]], large: [["s"]], xl: [["s", "x"]], xxl: [["x", "y"], ["s", "z", "y"]] });
    const walk = await walkFeed(readPages);
    expect(walk.stopReason).toBeNull();
    expect(walk.xxlReadings.map((r) => r.post.id)).toEqual(["y", "z"]);
    expect(walk.xxlPages).toBe(2);
    expect(walk.xxlStop).toBe("end of the feed");
    expect(walk.pages).toBe(5);
  });

  test("stops reading XXL once the walk made its budget of requests", async () => {
    const xxl = Array.from({ length: WALK_REQUEST_BUDGET }, (_, i) => [`p${i}`]);
    const { readPages, requests } = fakeFeed({ small: [["a"]], large: [["a"]], xl: [["a"]], xxl });
    const walk = await walkFeed(readPages);
    expect(requests.length).toBe(WALK_REQUEST_BUDGET);
    expect(walk.xxlPages).toBe(WALK_REQUEST_BUDGET - 3);
    expect(walk.xxlStop).toBe("budget");
  });

  test("stops reading XXL when X has no requests left, and the walk still counts as complete", async () => {
    const { readPages, requests } = fakeFeed({ small: [["a"]], large: [["a"]], xl: [["a"]], xxl: [["b"], ["c"]] }, (n) => (n === 4 ? 0 : 400));
    const walk = await walkFeed(readPages);
    expect(requests).toEqual(["small:0", "large:0", "xl:0", "xxl:0"]);
    expect(walk.stopReason).toBeNull();
    expect(walk.xxlStop).toBe("X has no requests left");
  });

  test("an X error ends the walk and keeps the readings it already has", async () => {
    const readPages = async function* (tier: FeedSize): AsyncGenerator<FeedPage> {
      if (tier !== "xl") return;
      yield { posts: [post("a")], rateRemaining: 400, isLastPage: false };
      throw Object.assign(new Error("Request failed"), { response: { status: 503, data: { title: "Service Unavailable" } } });
    };
    const walk = await walkFeed(readPages);
    expect(walk.stopReason).toBe('X error: Request failed; status 503 body={"title":"Service Unavailable"}');
    expect(walk.readings.map((r) => r.post.id)).toEqual(["a"]);
    expect(walk.xxlStop).toBe("not read, because the walk stopped");
  });
});
