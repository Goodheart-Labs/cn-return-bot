import { test, expect } from "bun:test";
import {
  velocityPerHour,
  formatVelocity,
  isAboveFloor,
  isAboveVelocityFloor,
  VELOCITY_MIN_AGE_HOURS,
  REGULAR_VELOCITY_FLOOR_PER_HOUR,
} from "./velocity";
import { partitionByVelocityFloor, type Candidate } from "../orchestration/submitCandidates";
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

test("isAboveFloor: boundary inclusive, null fails open, floor<=0 disables", () => {
  expect(isAboveFloor(4_000, 4_000)).toBe(true);
  expect(isAboveFloor(3_999, 4_000)).toBe(false);
  expect(isAboveFloor(null, 4_000)).toBe(true);
  expect(isAboveFloor(0, 0)).toBe(true);
  expect(isAboveFloor(-5, -1)).toBe(true);
});

test("isAboveVelocityFloor delegates against the regular floor", () => {
  expect(isAboveVelocityFloor(REGULAR_VELOCITY_FLOOR_PER_HOUR)).toBe(true);
  expect(isAboveVelocityFloor(REGULAR_VELOCITY_FLOOR_PER_HOUR - 1)).toBe(false);
  expect(isAboveVelocityFloor(null)).toBe(true);
});

// ── submission-layer pure functions ─────────────────────────────────────────
// Fixture velocities are EXTREME (≈0/h vs ≈10M/h) so these tests keep passing
// if the floor constant is retuned anywhere in a sane range.

// Candidate fixtures age relative to REAL now — partitionByVelocityFloor
// computes velocity as-of Date.now(), and a fixed timestamp would let fixture
// velocities decay as calendar time passes.
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

// Submission no longer re-sorts (candidates submit in pipeline order), so
// there is no ordering function here to test.

// ── selection-layer: the feed ladder ────────────────────────────────────────
// Tiers are filtered to above-floor posts, and the ladder broadens only while
// the pool is short of maxPosts. Velocities are stated as multiples of the
// floor so these keep passing if the floor is retuned.

/** A post `id` whose velocity is `floorMultiple` × the floor, as of NOW. Ids
 *  name the tier the post is served from and its standing versus the floor, so
 *  the assertions read as statements about the ladder. */
function feedPost(id: string, floorMultiple: number): Post {
  const ageHours = 2;
  return { ...post(REGULAR_VELOCITY_FLOOR_PER_HOUR * floorMultiple * ageHours, ageHours), id };
}

const ids = (posts: { post: Post }[]) => posts.map((s) => s.post.id);

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
    small: [feedPost("small-slower", 2), feedPost("small-faster", 3)],
    large: [feedPost("large-never-fetched", 9)],
  });
  const { selected } = await collectFastPosts(2, new Set(), fetchFeed, NOW);
  expect(fetched).toEqual(["small"]);
  expect(ids(selected)).toEqual(["small-faster", "small-slower"]); // fastest first
});

test("broadens to the next tier when a tier's above-floor posts fall short", async () => {
  const { fetched, fetchFeed } = fakeFeed({
    small: [feedPost("small-above-floor", 2), feedPost("small-below-floor", 0.5)],
    large: [feedPost("large-above-floor", 3)],
  });
  const { selected } = await collectFastPosts(2, new Set(), fetchFeed, NOW);
  expect(fetched).toEqual(["small", "large"]);
  // Tier-first ordering: the small post ranks above the faster large one.
  expect(ids(selected)).toEqual(["small-above-floor", "large-above-floor"]);
});

test("faster broad-tier posts never bump above-floor small posts", async () => {
  const { selected } = await collectFastPosts(
    3,
    new Set(),
    fakeFeed({
      small: [feedPost("small-slower", 1.2), feedPost("small-faster", 2)],
      large: [feedPost("large-blazing", 9)],
    }).fetchFeed,
    NOW,
  );
  // Both small posts (ordered by velocity) come before the much faster large one.
  expect(ids(selected)).toEqual(["small-faster", "small-slower", "large-blazing"]);
});

test("below-floor posts are dropped, not used to fill a short pool", async () => {
  const { fetchFeed } = fakeFeed({
    small: [feedPost("small-below-floor", 0.9)],
    large: [feedPost("large-below-floor", 0.1), feedPost("large-above-floor", 4)],
  });
  const { selected } = await collectFastPosts(5, new Set(), fetchFeed, NOW);
  expect(ids(selected)).toEqual(["large-above-floor"]);
});

test("already-known posts are skipped before the floor is applied", async () => {
  const { fetchFeed } = fakeFeed({
    small: [feedPost("already-known", 5), feedPost("unseen", 2)],
  });
  const { selected } = await collectFastPosts(5, new Set(["already-known"]), fetchFeed, NOW);
  expect(ids(selected)).toEqual(["unseen"]);
});

test("unknown velocity fails open but sorts last", async () => {
  const unknown = { ...post(undefined, 2), id: "unknown-velocity" };
  const { fetchFeed } = fakeFeed({ small: [unknown, feedPost("known-fast", 2)] });
  const { selected } = await collectFastPosts(5, new Set(), fetchFeed, NOW);
  expect(ids(selected)).toEqual(["known-fast", "unknown-velocity"]);
  expect(selected.map((s) => s.velocity)).toEqual([REGULAR_VELOCITY_FLOOR_PER_HOUR * 2, null]);
});

test("a failing tier falls through to the next instead of aborting the run", async () => {
  const { fetched, fetchFeed } = fakeFeed({ large: [feedPost("large-above-floor", 2)] });
  const failingSmall = async (feedSize: FeedSize) => {
    if (feedSize === "small") throw new Error("403");
    return fetchFeed(feedSize);
  };
  const { selected } = await collectFastPosts(1, new Set(), failingSmall, NOW);
  expect(fetched).toEqual(["large"]);
  expect(ids(selected)).toEqual(["large-above-floor"]);
});

test("fresh exposes below-floor posts from walked tiers (topic curation matches against it)", async () => {
  const { fetchFeed } = fakeFeed({
    small: [feedPost("small-below-floor", 0.5), feedPost("small-above-floor", 2)],
    large: [feedPost("large-never-fetched", 3)],
  });
  const { selected, fresh } = await collectFastPosts(1, new Set(), fetchFeed, NOW);
  expect(ids(selected)).toEqual(["small-above-floor"]);
  // The below-floor small post was dropped from selection but is still visible
  // in fresh; large was never fetched (pool filled at small), so it is not.
  expect(ids(fresh).sort()).toEqual(["small-above-floor", "small-below-floor"]);
});
