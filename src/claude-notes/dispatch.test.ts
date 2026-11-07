import { expect, test } from "bun:test";
import { judgeMayStartAt } from "./dispatch";

const now = new Date("2026-11-05T21:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

test("a judge starts below the weekly stop with a recent reading", () => {
  expect(judgeMayStartAt({ at: minutesAgo(5), weekly: 89 }, now)).toBe(true);
});

test("no judge starts at the weekly stop", () => {
  expect(judgeMayStartAt({ at: minutesAgo(5), weekly: 90 }, now)).toBe(false);
});

test("no judge starts without a recent reading", () => {
  expect(judgeMayStartAt({ at: minutesAgo(31), weekly: 10 }, now)).toBe(false);
  expect(judgeMayStartAt(null, now)).toBe(false);
});
