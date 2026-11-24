import { describe, expect, test } from "bun:test";
import {
  computeClaudePacing,
  DEFAULT_USAGE_PER_POST_PERCENT,
  WEEKLY_USAGE_TARGET_PERCENT,
  usageRise,
  type UsageReading,
  type UsageSnapshot,
} from "./usagePacing";

/* Covers the usage pacing of the Claude note writer (GOO-587, GOO-831): the
 * usage per API dollar is the rise over the runs' costs, a post uses that times
 * its average cost, the other runs keep their usage per hour until the reset,
 * and the posts share what is left of the target until the reset. */

const HOUR_MS = 3600_000;
const NOW = new Date("2026-10-26T12:00:00Z");
const RESET = new Date("2026-11-01T12:00:00Z");

const reading = (hoursAgo: number, weekly: number, weeklyResetsAt: Date | null = RESET): UsageReading => ({
  at: new Date(NOW.getTime() - hoursAgo * HOUR_MS),
  weekly,
  weeklyResetsAt,
});

/** 48 hours of readings with a 10-point rise, over $200 of runs: 0.05% per
 *  dollar. The 50 post runs cost $100, so a post costs $2 and uses 0.1%. The
 *  other runs cost $100 in 48 hours, which is 5 points, so they use about 15
 *  points in the 144 hours until the reset. */
const snapshot = (overrides: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  now: NOW,
  readings: [reading(48, 10), reading(0, 20)],
  costs: { postRuns: 50, postCostUsd: 100, otherCostUsd: 100 },
  ...overrides,
});

const claude = (snap: UsageSnapshot) => {
  const pacing = computeClaudePacing(snap);
  if (!pacing) throw new Error("expected a pacing");
  return pacing;
};

describe("usageRise", () => {
  test("adds up the increases and ignores the drop at the weekly reset", () => {
    expect(usageRise([reading(30, 18), reading(20, 20), reading(10, 0), reading(0, 3)])).toBe(5);
  });
});

describe("computeClaudePacing", () => {
  test("spreads what the other runs leave of the target over the time until the reset", () => {
    // The usage is at 20% and the other runs will use 15 points, so 55 points
    // are left for posts at 0.1% each: 550 posts in 144 hours, one about every
    // 15.7 minutes, stretched by 10%.
    const pacing = claude(snapshot());
    expect(pacing.usagePerDollar).toBeCloseTo(0.05);
    expect(pacing.usagePerPost).toBeCloseTo(0.1);
    expect(pacing.otherUsageUntilReset).toBeCloseTo(15);
    expect(pacing.intervalMs).toBeCloseTo((1.1 * 144 * HOUR_MS) / 550, -3);
  });

  test("more usage by the other runs leaves less for the posts, so the posts slow down", () => {
    const alone = claude(snapshot());
    // The other runs cost twice as much and the usage rose 5 points more.
    const busy = snapshot({ readings: [reading(48, 10), reading(0, 25)], costs: { postRuns: 50, postCostUsd: 100, otherCostUsd: 200 } });
    const alongsideMoreOtherWork = claude(busy);
    expect(alongsideMoreOtherWork.intervalMs).toBeGreaterThan(alone.intervalMs);
  });

  test("when the other runs will use up the target, no feed post is due", () => {
    // A 50-point rise in 48 hours, almost all of it by other runs, would carry
    // the other runs about 140 points further by the reset.
    const busy = snapshot({ readings: [reading(48, 10), reading(0, 60)], costs: { postRuns: 50, postCostUsd: 10, otherCostUsd: 190 } });
    expect(claude(busy).intervalMs).toBe(Infinity);
  });

  test("close to the reset with usage left, the posts come faster", () => {
    const early = claude(snapshot());
    // The same readings, 132 hours later and 12 hours before the reset.
    const later = (r: UsageReading) => ({ ...r, at: new Date(r.at.getTime() + 132 * HOUR_MS) });
    const late = claude(snapshot({ now: new Date(RESET.getTime() - 12 * HOUR_MS), readings: snapshot().readings.map(later) }));
    expect(late.intervalMs).toBeLessThan(early.intervalMs);
  });

  test("with too few post runs to measure, the default usage per post stands in", () => {
    const pacing = claude(snapshot({ costs: { postRuns: 2, postCostUsd: 4, otherCostUsd: 100 } }));
    expect(pacing.usagePerPost).toBe(DEFAULT_USAGE_PER_POST_PERCENT);
    expect(pacing.usagePerDollar).toBeNull();
    expect(pacing.otherUsageUntilReset).toBe(0);
  });

  test("a window without any rise uses the default, so the posts are not due all at once", () => {
    expect(claude(snapshot({ readings: [reading(48, 20), reading(0, 20)] })).usagePerPost).toBe(DEFAULT_USAGE_PER_POST_PERCENT);
  });

  test("at the target no new feed post is due until the reset", () => {
    expect(claude(snapshot({ readings: [reading(1, WEEKLY_USAGE_TARGET_PERCENT - 1), reading(0, WEEKLY_USAGE_TARGET_PERCENT)] })).intervalMs).toBe(Infinity);
  });

  test("with no reading at all there is no pacing", () => {
    expect(computeClaudePacing(snapshot({ readings: [] }))).toBeNull();
  });

  test("a reading that does not say when the week resets cannot pace", () => {
    expect(computeClaudePacing(snapshot({ readings: [reading(0, 20, null)] }))).toBeNull();
  });
});
