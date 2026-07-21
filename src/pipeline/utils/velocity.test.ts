import { test, expect } from "bun:test";
import { velocityPerHour, formatVelocity, VELOCITY_MIN_AGE_HOURS } from "./velocity";
import { partitionByVelocityFloor, orderWithReserve, type Candidate } from "../orchestration/submitCandidates";
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
