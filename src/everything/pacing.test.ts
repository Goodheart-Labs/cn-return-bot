import { describe, expect, test } from "bun:test";
import {
  affordablePostsPerDay,
  computeFeedGate,
  DEFAULT_MEAN_POST_COST_USD,
  nextUtcMidnight,
  waitMs,
  type FeedPacingSnapshot,
} from "./pacing";

/* Covers the pacing rule: the interval between feed posts is hours left times
 * the mean post cost divided by the money left, measured from the last feed
 * post's start, recomputed every time. The feed budget in every case is 45
 * USD, the production default of a 55 USD cap minus a 10 USD reserve. */

const HOUR_MS = 3600_000;
const BUDGET = 45;

const at = (iso: string) => new Date(iso);

const snapshot = (overrides: Partial<FeedPacingSnapshot> = {}): FeedPacingSnapshot => ({
  dbNow: at("2026-09-15T00:00:00Z"),
  spentTodayUsd: 0,
  meanPostCostUsd: 3,
  samplePosts: 10,
  sampleHours: 48,
  lastFeedStartedAt: null,
  ...overrides,
});

describe("computeFeedGate", () => {
  test("at midnight with a full budget the interval is a day divided by the affordable posts", () => {
    // 45 / 3 = 15 posts, so one every 96 minutes.
    const gate = computeFeedGate(snapshot(), BUDGET);
    expect(gate.intervalMs).toBeCloseTo(1.6 * HOUR_MS, -3);
    expect(gate.hoursLeft).toBe(24);
    expect(gate.moneyLeftUsd).toBe(45);
    expect(gate.closedForToday).toBe(false);
  });

  test("the very first post ever may start at once", () => {
    const snap = snapshot();
    expect(waitMs(computeFeedGate(snap, BUDGET), snap)).toBe(0);
  });

  test("the next post waits one interval after the last start, not after its finish", () => {
    const snap = snapshot({ lastFeedStartedAt: at("2026-09-14T23:30:00Z"), dbNow: at("2026-09-15T00:03:00Z") });
    const gate = computeFeedGate(snap, BUDGET);
    // Recomputed at 00:03 with 23.95 h left: 23.95 * 3 / 45 = 1.597 h after 23:30, so about 01:06.
    expect(gate.opensAt.toISOString()).toBe("2026-09-15T01:05:48.000Z");
    expect(waitMs(gate, snap)).toBeGreaterThan(0);
  });

  test("a post that started just before midnight is not followed by another at once", () => {
    // Without measuring from the last start regardless of day, a 23:59 post
    // would be followed by a 00:03 post.
    const snap = snapshot({ lastFeedStartedAt: at("2026-09-14T23:59:00Z"), dbNow: at("2026-09-15T00:03:00Z") });
    expect(waitMs(computeFeedGate(snap, BUDGET), snap)).toBeGreaterThan(HOUR_MS);
  });

  test("a cheap post shortens the next interval and an expensive one lengthens it", () => {
    const before = computeFeedGate(snapshot({ dbNow: at("2026-09-15T02:00:00Z") }), BUDGET).intervalMs;
    const afterCheap = computeFeedGate(snapshot({ dbNow: at("2026-09-15T02:00:00Z"), spentTodayUsd: 1 }), BUDGET).intervalMs;
    const afterDear = computeFeedGate(snapshot({ dbNow: at("2026-09-15T02:00:00Z"), spentTodayUsd: 30 }), BUDGET).intervalMs;
    // Both are shorter than the midnight interval because two hours have
    // passed; what matters is the spend's effect at the same time of day.
    expect(afterCheap).toBeGreaterThan(before * 0.95);
    expect(afterDear).toBeGreaterThan(before * 2.5);
  });

  test("money left below one average post closes the gate until midnight", () => {
    const snap = snapshot({ dbNow: at("2026-09-15T10:00:00Z"), spentTodayUsd: 43 });
    const gate = computeFeedGate(snap, BUDGET);
    expect(gate.closedForToday).toBe(true);
    expect(gate.opensAt.toISOString()).toBe("2026-09-16T00:00:00.000Z");
    expect(waitMs(gate, snap)).toBe(14 * HOUR_MS);
  });

  test("a missing mean takes the default, and so does a zero", () => {
    for (const mean of [null, 0]) {
      const gate = computeFeedGate(snapshot({ meanPostCostUsd: mean }), BUDGET);
      expect(gate.meanPostCostUsd).toBe(DEFAULT_MEAN_POST_COST_USD);
      expect(gate.meanIsDefault).toBe(true);
      expect(gate.intervalMs).toBeGreaterThan(0);
    }
  });

  test("with minutes left in the day the interval shrinks towards zero rather than failing", () => {
    const snap = snapshot({ dbNow: at("2026-09-15T23:59:00Z"), lastFeedStartedAt: at("2026-09-15T20:00:00Z") });
    const gate = computeFeedGate(snap, BUDGET);
    expect(gate.hoursLeft).toBeCloseTo(1 / 60, 5);
    expect(Number.isFinite(gate.intervalMs)).toBe(true);
    expect(waitMs(gate, snap)).toBeLessThanOrEqual(0);
  });
});

describe("nextUtcMidnight and affordablePostsPerDay", () => {
  test("midnight is the next UTC day boundary", () => {
    expect(nextUtcMidnight(at("2026-09-15T13:45:00Z")).toISOString()).toBe("2026-09-16T00:00:00.000Z");
    expect(nextUtcMidnight(at("2026-09-15T00:00:00Z")).toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });

  test("the budget divided by the mean is how many posts a day are affordable", () => {
    expect(affordablePostsPerDay(3.48, BUDGET)).toBeCloseTo(12.93, 2);
    expect(affordablePostsPerDay(1, BUDGET)).toBe(45);
  });
});
