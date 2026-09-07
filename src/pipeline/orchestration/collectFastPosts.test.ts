import { describe, expect, test } from "bun:test";
import { collectFastPosts } from "./generateCandidates";
import { flagsThenEval } from "../ranking/scorers";
import type { Post } from "../../api/fetchEligiblePosts";
import type { FeedSize } from "./utils/feedSizeStrategy";

const NOW = Date.parse("2026-09-03T12:00:00Z");

function post(id: string, impressionsPerHour: number, opts: { media?: boolean; followers?: number; ageH?: number } = {}): Post {
  const ageH = opts.ageH ?? 6;
  return {
    id,
    author_id: "a",
    created_at: new Date(NOW - ageH * 3_600_000).toISOString(),
    text: "",
    media: opts.media === false ? [] : [{ type: "photo" }],
    public_metrics: { impression_count: Math.round(impressionsPerHour * ageH) },
    author_followers: opts.followers ?? 10_000,
  } as unknown as Post;
}

const feeds: Record<FeedSize, Post[]> = {
  small: [post("s1", 6_000), post("s2", 7_000)],
  large: [post("l1", 400_000), post("l2", 50_000, { media: false })],
  xl: [post("x1", 900_000)],
  xxl: [],
};
const fetched: FeedSize[] = [];
const fetchFeed = async (size: FeedSize) => {
  fetched.push(size);
  return feeds[size] ?? [];
};

describe("collectFastPosts", () => {
  test("without a scorer it stops at the first tier that fills and orders tier first", async () => {
    fetched.length = 0;
    const { selected } = await collectFastPosts(2, new Set(), fetchFeed, NOW);
    expect(fetched).toEqual(["small"]);
    expect(selected.map((s) => s.post.id)).toEqual(["s2", "s1"]);
  });

  test("with a scorer it walks every tier and ranks across them", async () => {
    fetched.length = 0;
    const { selected } = await collectFastPosts(2, new Set(), fetchFeed, NOW, flagsThenEval);
    expect(fetched).toEqual(["small", "large", "xl"]);
    // x1 and l1 have all four flags and the highest velocity; the slow small posts lose.
    expect(selected.map((s) => s.post.id)).toEqual(["x1", "l1"]);
  });
});
