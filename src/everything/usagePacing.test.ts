import { describe, expect, test } from "bun:test";
import {
  computeClaudePacing,
  DEFAULT_USAGE_PER_POST_PERCENT,
  usageRise,
  type UsageReading,
  type UsageSnapshot,
} from "./usagePacing";

/* Covers the usage pacing of the Claude note writer (GOO-587): the interval
 * between posts is 1.1 times the time until the weekly reset times the usage
 * per post, divided by the usage left below 80%; the usage per post is
 * measured; and no new post comes at the target. */

const HOUR_MS = 3600_000;
const NOW = new Date("2026-10-26T12:00:00Z");
const RESET = new Date("2026-11-01T12:00:00Z");

const reading = (hoursAgo: number, weekly: number, weeklyResetsAt: Date | null = RESET): UsageReading => ({
  at: new Date(NOW.getTime() - hoursAgo * HOUR_MS),
  weekly,
  weeklyResetsAt,
});

const snapshot = (overrides: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  now: NOW,
  readings: [reading(48, 10), reading(0, 20)],
  postsTaken: 100,
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
  test("spreads the usage left over the time until the reset", () => {
    // 10 points over 100 posts is 0.1 per post. 60 points are left below 80%,
    // which is 600 posts in the 144 hours until the reset: one every 14.4
    // minutes, stretched by 10% to 15.84.
    const pacing = claude(snapshot());
    expect(pacing.usagePerPost).toBeCloseTo(0.1);
    expect(pacing.intervalMs).toBeCloseTo((1.1 * 144 * HOUR_MS) / 600, -3);
  });

  test("more usage by other work makes a post look dearer, so posts slow down", () => {
    const alone = claude(snapshot());
    const alongsideOtherWork = claude(snapshot({ readings: [reading(48, 0), reading(0, 20)] }));
    expect(alongsideOtherWork.intervalMs).toBeGreaterThan(alone.intervalMs);
  });

  test("close to the reset with usage left, the posts come faster", () => {
    const early = claude(snapshot());
    // The same readings, 132 hours later and 12 hours before the reset.
    const later = (r: UsageReading) => ({ ...r, at: new Date(r.at.getTime() + 132 * HOUR_MS) });
    const late = claude(snapshot({ now: new Date(RESET.getTime() - 12 * HOUR_MS), readings: snapshot().readings.map(later) }));
    expect(late.intervalMs).toBeLessThan(early.intervalMs);
  });

  test("with too few posts to measure, the default usage per post stands in", () => {
    const pacing = claude(snapshot({ postsTaken: 2 }));
    expect(pacing.usagePerPost).toBe(DEFAULT_USAGE_PER_POST_PERCENT);
    expect(pacing.usagePerPostIsDefault).toBe(true);
  });

  test("a window without any rise uses the default, so the posts are not due all at once", () => {
    expect(claude(snapshot({ readings: [reading(48, 20), reading(0, 20)] })).usagePerPost).toBe(DEFAULT_USAGE_PER_POST_PERCENT);
  });

  test("at the target no new feed post is due until the reset", () => {
    expect(claude(snapshot({ readings: [reading(1, 79), reading(0, 80)] })).intervalMs).toBe(Infinity);
  });

  test("with no reading at all there is no pacing", () => {
    expect(computeClaudePacing(snapshot({ readings: [] }))).toBeNull();
  });

  test("a reading that does not say when the week resets cannot pace", () => {
    expect(computeClaudePacing(snapshot({ readings: [reading(0, 20, null)] }))).toBeNull();
  });
});
