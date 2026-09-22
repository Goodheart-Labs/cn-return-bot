import { afterEach, expect, test } from "bun:test";
import { raterBarFrom, raterBarKeepShare } from "./raterBar";

afterEach(() => { delete process.env.NOTE_BAR_KEEP_SHARE; });

test("no bar with too few scores, or when everything is kept", () => {
  expect(raterBarFrom(Array.from({ length: 49 }, (_, i) => i / 100), 0.5)).toBeNull();
  expect(raterBarFrom(Array.from({ length: 200 }, (_, i) => i / 100), 1)).toBeNull();
});

test("keeping the top half puts the bar at the median", () => {
  const scores = Array.from({ length: 100 }, (_, i) => i / 100);
  expect(raterBarFrom(scores, 0.5)).toBeCloseTo(0.5);
  expect(raterBarFrom(scores, 0.2)).toBeCloseTo(0.8);
});

test("the keep share comes from the repo variable and defaults to a half", () => {
  expect(raterBarKeepShare()).toBe(0.5);
  process.env.NOTE_BAR_KEEP_SHARE = "0.3"; expect(raterBarKeepShare()).toBe(0.3);
  process.env.NOTE_BAR_KEEP_SHARE = "nonsense"; expect(raterBarKeepShare()).toBe(0.5);
});
