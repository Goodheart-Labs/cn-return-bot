import { describe, expect, test } from "bun:test";
import {
  affordablePostsPerDay,
  computeNextRun,
  DEFAULT_MEAN_POST_COST_USD,
  IDLE_RECHECK_MS,
  MEAN_COST_RULE,
  nextAlarm,
  nextUtcMidnight,
  type FeedPacingSnapshot,
} from "./pacing";

/* Covers the pacing rule: the interval between feed posts is hours left times
 * the mean post cost divided by the money left, measured from the last feed
 * post's start, recomputed every time; and the alarm a run sets from it. The
 * feed budget in every case is 45 USD, the production default of a 55 USD cap
 * minus a 10 USD reserve. */

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

/** How long from the snapshot's clock until the next run is due. */
const dueIn = (snap: FeedPacingSnapshot) => computeNextRun(snap, BUDGET).dueAt.getTime() - snap.dbNow.getTime();

describe("computeNextRun", () => {
  test("at midnight with a full budget the interval is a day divided by the affordable posts", () => {
    // 45 / 3 = 15 posts, so one every 96 minutes.
    const next = computeNextRun(snapshot(), BUDGET);
    expect(next.intervalMs).toBeCloseTo(1.6 * HOUR_MS, -3);
    expect(next.hoursLeft).toBe(24);
    expect(next.moneyLeftUsd).toBe(45);
    expect(next.closedForToday).toBe(false);
  });

  test("the very first post ever is due at once", () => {
    expect(dueIn(snapshot())).toBe(0);
  });

  test("the next post is due one interval after the last start, not after its finish", () => {
    const snap = snapshot({ lastFeedStartedAt: at("2026-09-14T23:30:00Z"), dbNow: at("2026-09-15T00:03:00Z") });
    // Recomputed at 00:03 with 23.95 h left: 23.95 * 3 / 45 = 1.597 h after 23:30, so about 01:06.
    expect(computeNextRun(snap, BUDGET).dueAt.toISOString()).toBe("2026-09-15T01:05:48.000Z");
    expect(dueIn(snap)).toBeGreaterThan(0);
  });

  test("a post that started just before midnight is not followed by another at once", () => {
    // Without measuring from the last start regardless of day, a 23:59 post
    // would be followed by a 00:03 post.
    const snap = snapshot({ lastFeedStartedAt: at("2026-09-14T23:59:00Z"), dbNow: at("2026-09-15T00:03:00Z") });
    expect(dueIn(snap)).toBeGreaterThan(HOUR_MS);
  });

  test("a cheap post shortens the next interval and an expensive one lengthens it", () => {
    const before = computeNextRun(snapshot({ dbNow: at("2026-09-15T02:00:00Z") }), BUDGET).intervalMs;
    const afterCheap = computeNextRun(snapshot({ dbNow: at("2026-09-15T02:00:00Z"), spentTodayUsd: 1 }), BUDGET).intervalMs;
    const afterDear = computeNextRun(snapshot({ dbNow: at("2026-09-15T02:00:00Z"), spentTodayUsd: 30 }), BUDGET).intervalMs;
    // Both are shorter than the midnight interval because two hours have
    // passed; what matters is the spend's effect at the same time of day.
    expect(afterCheap).toBeGreaterThan(before * 0.95);
    expect(afterDear).toBeGreaterThan(before * 2.5);
  });

  test("money left below one average post makes the next run due at midnight", () => {
    const snap = snapshot({ dbNow: at("2026-09-15T10:00:00Z"), spentTodayUsd: 43 });
    const next = computeNextRun(snap, BUDGET);
    expect(next.closedForToday).toBe(true);
    expect(next.dueAt.toISOString()).toBe("2026-09-16T00:00:00.000Z");
    expect(dueIn(snap)).toBe(14 * HOUR_MS);
  });

  test("a thin sample is held to at least the default, a full sample is not, and a thin dear sample stays", () => {
    const thinCheap = computeNextRun(snapshot({ meanPostCostUsd: 0.0002, samplePosts: 1 }), BUDGET);
    expect(thinCheap.meanPostCostUsd).toBe(DEFAULT_MEAN_POST_COST_USD);
    expect(thinCheap.meanIsFloored).toBe(true);
    expect(thinCheap.meanIsDefault).toBe(false);
    const fullCheap = computeNextRun(snapshot({ meanPostCostUsd: 0.0002, samplePosts: MEAN_COST_RULE.minPosts }), BUDGET);
    expect(fullCheap.meanPostCostUsd).toBe(0.0002);
    expect(fullCheap.meanIsFloored).toBe(false);
    const thinDear = computeNextRun(snapshot({ meanPostCostUsd: 4, samplePosts: 1 }), BUDGET);
    expect(thinDear.meanPostCostUsd).toBe(4);
  });

  test("a missing mean takes the default, and so does a zero", () => {
    for (const mean of [null, 0]) {
      const next = computeNextRun(snapshot({ meanPostCostUsd: mean }), BUDGET);
      expect(next.meanPostCostUsd).toBe(DEFAULT_MEAN_POST_COST_USD);
      expect(next.meanIsDefault).toBe(true);
      expect(next.intervalMs).toBeGreaterThan(0);
    }
  });

  test("with minutes left in the day the interval shrinks towards zero rather than failing", () => {
    const snap = snapshot({ dbNow: at("2026-09-15T23:59:00Z"), lastFeedStartedAt: at("2026-09-15T20:00:00Z") });
    const next = computeNextRun(snap, BUDGET);
    expect(next.hoursLeft).toBeCloseTo(1 / 60, 5);
    expect(Number.isFinite(next.intervalMs)).toBe(true);
    expect(dueIn(snap)).toBeLessThanOrEqual(0);
  });
});

describe("nextAlarm", () => {
  test("after a post the alarm is one interval after that post started", () => {
    const snap = snapshot({ lastFeedStartedAt: at("2026-09-15T10:00:00Z"), dbNow: at("2026-09-15T10:05:00Z"), spentTodayUsd: 3 });
    const alarm = nextAlarm(computeNextRun(snap, BUDGET), snap, true);
    expect(alarm.reason).toBe("interval");
    expect(alarm.at.toISOString()).toBe(computeNextRun(snap, BUDGET).dueAt.toISOString());
    expect(alarm.at.getTime()).toBeGreaterThan(snap.dbNow.getTime());
  });

  test("a post that outlasted its interval leaves the alarm in the past, so the next run starts at once", () => {
    // 15 posts a day is one every 96 minutes; this post took two hours.
    const snap = snapshot({ lastFeedStartedAt: at("2026-09-15T10:00:00Z"), dbNow: at("2026-09-15T12:00:00Z"), spentTodayUsd: 3 });
    const alarm = nextAlarm(computeNextRun(snap, BUDGET), snap, true);
    expect(alarm.reason).toBe("interval");
    expect(alarm.at.getTime()).toBeLessThan(snap.dbNow.getTime());
  });

  test("when the money left does not cover one average post the alarm is midnight", () => {
    const snap = snapshot({ dbNow: at("2026-09-15T10:00:00Z"), spentTodayUsd: 43, lastFeedStartedAt: at("2026-09-15T09:00:00Z") });
    const alarm = nextAlarm(computeNextRun(snap, BUDGET), snap, true);
    expect(alarm).toEqual({ at: at("2026-09-16T00:00:00Z"), reason: "midnight" });
  });

  test("a run that found nothing to process asks again after the idle wait", () => {
    const snap = snapshot({ dbNow: at("2026-09-15T10:00:00Z"), lastFeedStartedAt: at("2026-09-15T06:00:00Z") });
    const alarm = nextAlarm(computeNextRun(snap, BUDGET), snap, false);
    expect(alarm).toEqual({ at: new Date(snap.dbNow.getTime() + IDLE_RECHECK_MS), reason: "idle" });
  });

  test("an idle run on a spent day still waits for midnight, not the idle wait", () => {
    const snap = snapshot({ dbNow: at("2026-09-15T10:00:00Z"), spentTodayUsd: 45 });
    expect(nextAlarm(computeNextRun(snap, BUDGET), snap, false).reason).toBe("midnight");
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
