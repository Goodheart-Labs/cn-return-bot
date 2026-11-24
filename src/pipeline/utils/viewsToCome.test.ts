import { describe, expect, test } from "bun:test";
import { effectiveHoursLeft, predictViewsToCome } from "./viewsToCome";

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
