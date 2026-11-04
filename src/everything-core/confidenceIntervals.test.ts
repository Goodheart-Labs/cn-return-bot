import { expect, test } from "bun:test";
import { nonNegativeMeanCI } from "./confidenceIntervals";

test("the mean interval matches the textbook formula for runs costing 1, 2 and 3 dollars", () => {
  // The mean is 2 and the sample variance is 1, so the standard error is 1/√3.
  const z = 1.96;
  const interval = nonNegativeMeanCI(1 + 2 + 3, 1 + 4 + 9, 3, z);
  expect(interval.point).toBe(2);
  expect(interval.lo).toBeCloseTo(2 - z / Math.sqrt(3));
  expect(interval.hi).toBeCloseTo(2 + z / Math.sqrt(3));
});

test("the mean interval never reaches below zero", () => {
  // Runs costing 0, 0 and 3 dollars have a mean of 1 and a wide spread.
  expect(nonNegativeMeanCI(3, 9, 3, 1.96).lo).toBe(0);
});
