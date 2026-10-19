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
  small: [post("s1", 16_000), post("s2", 17_000)],
  large: [post("l1", 400_000), post("l2", 50_000, { media: false })],
  xl: [post("x1", 900_000)],
  xxl: [],
};
const noSkips = async () => new Set<string>();
const fetched: FeedSize[] = [];
const fetchFeed = async (size: FeedSize) => {
  fetched.push(size);
  return feeds[size] ?? [];
};

describe("collectFastPosts", () => {
  test("without a scorer it stops at the first tier that fills and orders tier first", async () => {
    fetched.length = 0;
    const { selected } = await collectFastPosts(2, noSkips, fetchFeed, NOW);
    expect(fetched).toEqual(["small"]);
    expect(selected.map((s) => s.post.id)).toEqual(["s2", "s1"]);
  });

  test("with a scorer it walks every tier and ranks across them", async () => {
    fetched.length = 0;
    const { selected } = await collectFastPosts(2, noSkips, fetchFeed, NOW, flagsThenEval);
    expect(fetched).toEqual(["small", "large", "xl"]);
    // x1 and l1 have all four flags and the highest velocity; the slow small posts lose.
    expect(selected.map((s) => s.post.id)).toEqual(["x1", "l1"]);
  });

  test("a post already past the stale cutoff is not selected, however fast it is", async () => {
    // The stale post is 30 hours old with a huge velocity. Selecting it would
    // waste a run, because the submit phase discards notes on tweets past 24h.
    const staleFeeds: Record<FeedSize, Post[]> = {
      small: [post("fresh", 16_000), post("stale", 500_000, { ageH: 30 })],
      large: [],
      xl: [],
      xxl: [],
    };
    const { selected, fresh } = await collectFastPosts(2, noSkips, async (size) => staleFeeds[size] ?? [], NOW);
    expect(selected.map((s) => s.post.id)).toEqual(["fresh"]);
    // The stale post stays discoverable for topic curation, which works on the
    // longer 48h misinfo window.
    expect(fresh.map((s) => s.post.id)).toContain("stale");
  });

  test("a post whose age cannot be worked out is kept", async () => {
    const undatable = { ...post("nodate", 18_000), id: "not-a-snowflake", created_at: undefined } as unknown as Post;
    const noAgeFeeds: Record<FeedSize, Post[]> = { small: [undatable], large: [], xl: [], xxl: [] };
    const { selected } = await collectFastPosts(1, noSkips, async (size) => noAgeFeeds[size] ?? [], NOW);
    expect(selected.map((s) => s.post.id)).toEqual(["not-a-snowflake"]);
  });

  test("asks about each tier's new posts only and drops the ones it is told to skip", async () => {
    // l1 appears in both tiers. The second tier must not ask about it again.
    const overlapping: Record<FeedSize, Post[]> = {
      small: [post("s1", 16_000), post("l1", 400_000)],
      large: [post("l1", 400_000), post("l3", 300_000)],
      xl: [],
      xxl: [],
    };
    const asked: string[][] = [];
    const findSkippedIds = async (ids: string[]) => {
      asked.push(ids);
      return new Set(ids.filter((id) => id === "s1"));
    };
    const { fresh } = await collectFastPosts(5, findSkippedIds, async (size) => overlapping[size] ?? [], NOW);
    expect(asked).toEqual([["s1", "l1"], ["l3"], []]);
    expect(fresh.map((s) => s.post.id)).toEqual(["l1", "l3"]);
  });
});
