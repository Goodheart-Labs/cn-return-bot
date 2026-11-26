import { describe, expect, test } from "bun:test";
import type { Post } from "../../api/fetchEligiblePosts";
import { effectiveHoursLeft, predictViewsToCome, readingsOf, scoreReadings } from "./viewsToCome";

const HOUR_MS = 3_600_000;

describe("effectiveHoursLeft", () => {
  // The values production_fit.py printed for the fitted model.
  test.each([
    [1, 5.64],
    [3, 9.71],
    [12, 12.83],
    [22, 7.67],
    [23.9, 6.19],
  ])("at %p hours it matches the fitted model", (age, expected) => {
    expect(effectiveHoursLeft(age)).toBeCloseTo(expected, 1);
  });

  test("jumps back up once the 24-hour cliff is past", () => {
    expect(effectiveHoursLeft(25)).toBeGreaterThan(effectiveHoursLeft(23.9));
  });

  test("is zero at 48 hours", () => {
    expect(effectiveHoursLeft(48)).toBe(0);
  });
});

describe("predictViewsToCome", () => {
  const posted = 0;
  test("multiplies the speed between the readings by the hours left", () => {
    const earlier = { impressions: 100_000, observedAtMs: 12 * HOUR_MS - HOUR_MS / 6 };
    const now = { impressions: 101_000, observedAtMs: 12 * HOUR_MS };
    expect(predictViewsToCome(posted, earlier, now)!).toBeCloseTo(6_000 * effectiveHoursLeft(12), 0);
  });

  test("a count that went down is no growth", () => {
    const predicted = predictViewsToCome(posted, { impressions: 5_000, observedAtMs: HOUR_MS }, { impressions: 4_000, observedAtMs: 2 * HOUR_MS });
    expect(predicted).toBe(0);
  });

  test("is unknown without an earlier reading or with readings out of order", () => {
    const now = { impressions: 4_000, observedAtMs: 2 * HOUR_MS };
    expect(predictViewsToCome(posted, undefined, now)).toBeNull();
    expect(predictViewsToCome(posted, { impressions: 1, observedAtMs: 3 * HOUR_MS }, now)).toBeNull();
  });
});

describe("scoreReadings", () => {
  const NOW = Date.parse("2026-11-23T12:00:00Z");
  const TEN_MINUTES = 10 * 60_000;
  const post = (id: string, impressions: number | undefined, ageHours: number): Post => ({
    id, author_id: "a", text: "", media: [],
    created_at: new Date(NOW - ageHours * HOUR_MS).toISOString(),
    public_metrics: impressions === undefined ? undefined : { impression_count: impressions },
  } as unknown as Post);
  const before = readingsOf([{ post: post("a", 100_000, 6), observedAt: new Date(NOW - TEN_MINUTES) }, { post: post("old", 100_000, 49), observedAt: new Date(NOW - TEN_MINUTES) }]);
  const scores = scoreReadings([
    { post: post("a", 101_000, 6), observedAt: new Date(NOW) },
    { post: post("old", 200_000, 49), observedAt: new Date(NOW) },
    { post: post("new", 900_000, 1), observedAt: new Date(NOW) },
    { post: post("no-count", undefined, 6), observedAt: new Date(NOW) },
  ], before);

  test("scores a post from its gain since the walk before", () => {
    // 1,000 views in 10 minutes are 6,000 an hour.
    expect(scores.get("a")).toBeCloseTo(6000 * effectiveHoursLeft(6), 0);
    expect(scores.get("old")).toBe(0);
  });

  test("gives no score without a reading before or a count now", () => {
    expect(scores.get("new")).toBeNull();
    expect(scores.get("no-count")).toBeNull();
  });
});
