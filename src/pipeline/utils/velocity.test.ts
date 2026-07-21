import { test, expect } from "bun:test";
import { velocityPerHour, formatVelocity, VELOCITY_MIN_AGE_HOURS, REGULAR_VELOCITY_FLOOR_PER_HOUR } from "./velocity";
import { partitionByVelocityFloor, orderWithReserve, type Candidate } from "../orchestration/submitCandidates";
import { collectFastPosts } from "../orchestration/generateCandidates";
import type { FeedSize } from "../orchestration/utils/feedSizeStrategy";
import type { Post } from "../../api/fetchEligiblePosts";
import type { ProcessTweetResult } from "../orchestration/processTweet";

const HOUR_MS = 3_600_000;
const NOW = Date.parse("2026-07-20T12:00:00Z");

function post(impressions: number | undefined, ageHours: number | null): Post {
  return {
    id: "t1",
    author_id: "a1",
    created_at: ageHours === null ? (undefined as unknown as string) : new Date(NOW - ageHours * HOUR_MS).toISOString(),
    text: "",
    media: [],
    public_metrics: impressions === undefined ? undefined : { impression_count: impressions },
  };
}

test("velocity = impressions / hours since posting", () => {
  expect(velocityPerHour(post(10_000, 2), NOW)).toBeCloseTo(5_000);
});

test("age below the minimum clamps to the minimum (conservative for young posts)", () => {
  // 5 minutes old → measured as if VELOCITY_MIN_AGE_HOURS old.
  expect(velocityPerHour(post(1_000, 5 / 60), NOW)).toBeCloseTo(1_000 / VELOCITY_MIN_AGE_HOURS);
});

test("negative age (clock skew) clamps to the minimum instead of going negative", () => {
  expect(velocityPerHour(post(1_000, -1), NOW)).toBeCloseTo(1_000 / VELOCITY_MIN_AGE_HOURS);
});

test("missing impressions or timestamp returns null (callers fail open)", () => {
  expect(velocityPerHour(post(undefined, 2), NOW)).toBeNull();
  expect(velocityPerHour(post(1_000, null), NOW)).toBeNull();
  expect(velocityPerHour({ ...post(1_000, 2), created_at: "not a date" }, NOW)).toBeNull();
});

test("formatVelocity", () => {
  expect(formatVelocity(12_340)).toBe("12.3K/h");
  expect(formatVelocity(null)).toBe("?");
});

// ── submission-layer pure functions ─────────────────────────────────────────
// Fixture velocities are EXTREME (≈0/h vs ≈10M/h) so these tests keep passing
// if the floor constant is retuned anywhere in a sane range.

// Candidate fixtures age relative to REAL now — partitionByVelocityFloor and
// orderWithReserve compute velocity as-of Date.now(), and a fixed timestamp
// would let fixture velocities decay as calendar time passes.
function livePost(impressions: number | undefined, ageHours: number | null): Post {
  return {
    ...post(impressions, null),
    created_at: ageHours === null ? (undefined as unknown as string) : new Date(Date.now() - ageHours * HOUR_MS).toISOString(),
  };
}

function candidate(id: string, opts: { impressions?: number; ageHours?: number | null; eval?: number; misinfo?: boolean; runId?: string }): Candidate {
  return {
    post: { ...livePost(opts.impressions, opts.ageHours ?? 1), id },
    tweetResult: {
      evaluationScore: opts.eval,
      pipelineRunId: opts.runId ?? `run-${id}`,
    } as unknown as ProcessTweetResult,
    botId: "test-bot",
    isMisinfo: opts.misinfo,
  };
}

const crawling = { impressions: 1, ageHours: 40 };            // ~0/h
const viral = { impressions: 10_000_000, ageHours: 1 };       // 10M/h

test("floor cuts slow non-misinfo candidates, keeps fast ones", () => {
  const slow = candidate("slow", crawling);
  const fast = candidate("fast", viral);
  const { kept, floorCut } = partitionByVelocityFloor([slow, fast]);
  expect(kept.map((c) => c.post.id)).toEqual(["fast"]);
  expect(floorCut.map((f) => f.candidate.post.id)).toEqual(["slow"]);
});

test("floor never cuts misinfo candidates (topic has its own floor at selection)", () => {
  const slowTopic = candidate("slow-topic", { ...crawling, misinfo: true });
  const { kept, floorCut } = partitionByVelocityFloor([slowTopic]);
  expect(kept).toHaveLength(1);
  expect(floorCut).toHaveLength(0);
});

test("unknown velocity fails open (kept, not cut)", () => {
  const unknown = candidate("unknown", { impressions: undefined, ageHours: 2 });
  const { kept, floorCut } = partitionByVelocityFloor([unknown]);
  expect(kept).toHaveLength(1);
  expect(floorCut).toHaveLength(0);
});

test("reserve boost picks the FASTEST misinfo notes, rest stays eval-sorted", () => {
  const mSlow = candidate("m-slow", { ...crawling, misinfo: true, eval: 0.9 });
  const mFast = candidate("m-fast", { ...viral, misinfo: true, eval: -5 });
  const rHigh = candidate("r-high", { ...viral, eval: 0.8 });
  const rLow = candidate("r-low", { ...viral, eval: 0.1 });
  const ordered = orderWithReserve([rLow, mSlow, rHigh, mFast], 1);
  // Boost = 1 slot → the fastest misinfo note (m-fast) leads despite eval -5;
  // m-slow falls back into the eval-sorted rest.
  expect(ordered.map((c) => c.post.id)).toEqual(["m-fast", "m-slow", "r-high", "r-low"]);
});

test("no reserve remaining → plain eval sort", () => {
  const m = candidate("m", { ...viral, misinfo: true, eval: -5 });
  const r = candidate("r", { ...viral, eval: 0.5 });
  expect(orderWithReserve([m, r], 0).map((c) => c.post.id)).toEqual(["r", "m"]);
});

// ── selection-layer: the feed ladder ────────────────────────────────────────
// Tiers are filtered to above-floor posts, and the ladder broadens only while
// the pool is short of maxPosts. Velocities are stated as multiples of the
// floor so these keep passing if the floor is retuned.

/** A post `id` whose velocity is `floorMultiple` × the floor, as of NOW. */
function feedPost(id: string, floorMultiple: number): Post {
  const ageHours = 2;
  return { ...post(REGULAR_VELOCITY_FLOOR_PER_HOUR * floorMultiple * ageHours, ageHours), id };
}

/** Serves each tier's posts and records which tiers were actually fetched. */
function fakeFeed(tiers: Partial<Record<FeedSize, Post[]>>) {
  const fetched: FeedSize[] = [];
  return {
    fetched,
    fetchFeed: async (feedSize: FeedSize) => {
      fetched.push(feedSize);
      return tiers[feedSize] ?? [];
    },
  };
}

test("stops at the first tier that supplies enough above-floor posts", async () => {
  const { fetched, fetchFeed } = fakeFeed({
    small: [feedPost("s1", 2), feedPost("s2", 3)],
    large: [feedPost("l1", 9)],
  });
  const selected = await collectFastPosts(2, new Set(), fetchFeed, NOW);
  expect(fetched).toEqual(["small"]);
  expect(selected.map((s) => s.post.id)).toEqual(["s2", "s1"]); // fastest first
});

test("broadens to the next tier when a tier's above-floor posts fall short", async () => {
  const { fetched, fetchFeed } = fakeFeed({
    small: [feedPost("s1", 2), feedPost("slow", 0.5)],
    large: [feedPost("l1", 3)],
  });
  const selected = await collectFastPosts(2, new Set(), fetchFeed, NOW);
  expect(fetched).toEqual(["small", "large"]);
  expect(selected.map((s) => s.post.id)).toEqual(["l1", "s1"]);
});

test("below-floor posts are dropped, not used to fill a short pool", async () => {
  const { fetchFeed } = fakeFeed({
    small: [feedPost("slow1", 0.9)],
    large: [feedPost("slow2", 0.1), feedPost("fast", 4)],
  });
  const selected = await collectFastPosts(5, new Set(), fetchFeed, NOW);
  expect(selected.map((s) => s.post.id)).toEqual(["fast"]);
});

test("already-known posts are skipped before the floor is applied", async () => {
  const { fetchFeed } = fakeFeed({ small: [feedPost("seen", 5), feedPost("new", 2)] });
  const selected = await collectFastPosts(5, new Set(["seen"]), fetchFeed, NOW);
  expect(selected.map((s) => s.post.id)).toEqual(["new"]);
});

test("unknown velocity fails open but sorts last", async () => {
  const unknown = { ...post(undefined, 2), id: "unknown" };
  const { fetchFeed } = fakeFeed({ small: [unknown, feedPost("fast", 2)] });
  const selected = await collectFastPosts(5, new Set(), fetchFeed, NOW);
  expect(selected.map((s) => s.post.id)).toEqual(["fast", "unknown"]);
  expect(selected.map((s) => s.velocity)).toEqual([REGULAR_VELOCITY_FLOOR_PER_HOUR * 2, null]);
});

test("a failing tier falls through to the next instead of aborting the run", async () => {
  const { fetched, fetchFeed } = fakeFeed({ large: [feedPost("l1", 2)] });
  const failingSmall = async (feedSize: FeedSize) => {
    if (feedSize === "small") throw new Error("403");
    return fetchFeed(feedSize);
  };
  const selected = await collectFastPosts(1, new Set(), failingSmall, NOW);
  expect(fetched).toEqual(["large"]);
  expect(selected.map((s) => s.post.id)).toEqual(["l1"]);
});
