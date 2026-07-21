import { expect, test } from "bun:test";
import type { Post } from "../../api/fetchEligiblePosts";
import { AB_TESTS } from "../ab-testing/abTestsData";
import { collectVelocityRankedPosts } from "./generateCandidates";
import type { FeedSize } from "./utils/feedSizeStrategy";

const NOW = Date.parse("2026-07-21T12:00:00Z");
const HOUR_MS = 3_600_000;

test("feed size is not an A/B-test dimension", () => {
  expect(AB_TESTS.some(({ name }) => name === "feed_size")).toBe(false);
});

function post(id: string, impressions: number | undefined, ageHours = 1): Post {
  return {
    id,
    author_id: `author-${id}`,
    created_at: new Date(NOW - ageHours * HOUR_MS).toISOString(),
    text: id,
    media: [],
    public_metrics: impressions === undefined ? undefined : { impression_count: impressions },
  };
}

test("large feed is sufficient: skips broader tiers and selects by velocity", async () => {
  const calls: FeedSize[] = [];
  const result = await collectVelocityRankedPosts(2, new Set(), async (feedSize) => {
    calls.push(feedSize);
    return [post("slow", 1_000, 2), post("unknown", undefined), post("fast", 10_000, 1)];
  }, NOW);

  expect(calls).toEqual(["large"]);
  expect(result.selected.map(({ post }) => post.id)).toEqual(["fast", "slow"]);
  expect(result.allNew).toHaveLength(3);
});

test("tops up from XL, dedupes overlapping tiers, then ranks the combined pool", async () => {
  const calls: FeedSize[] = [];
  const known = new Set(["known"]);
  const result = await collectVelocityRankedPosts(3, known, async (feedSize) => {
    calls.push(feedSize);
    if (feedSize === "large") return [post("known", 100_000), post("slow", 1_000, 2)];
    if (feedSize === "xl") return [post("slow", 1_000, 2), post("fast", 20_000), post("medium", 8_000)];
    throw new Error("XXL should not be fetched once the pool is full");
  }, NOW);

  expect(calls).toEqual(["large", "xl"]);
  expect(result.selected.map(({ post }) => post.id)).toEqual(["fast", "medium", "slow"]);
  expect(result.allNew.map((post) => post.id)).toEqual(["slow", "fast", "medium"]);
});

test("feed failures fall through to the next tier", async () => {
  const calls: FeedSize[] = [];
  const result = await collectVelocityRankedPosts(2, new Set(), async (feedSize) => {
    calls.push(feedSize);
    if (feedSize === "large") throw new Error("403");
    if (feedSize === "xl") return [];
    return [post("xxl-fast", 5_000), post("xxl-slow", 1_000)];
  }, NOW);

  expect(calls).toEqual(["large", "xl", "xxl"]);
  expect(result.selected.map(({ post }) => post.id)).toEqual(["xxl-fast", "xxl-slow"]);
  expect(result.selected.every(({ feedSize }) => feedSize === "xxl")).toBe(true);
});
