import { expect, test } from "bun:test";
import { bucketKey, noteBuckets, originBuckets } from "./chartBuckets";

const day = (d: string, helpful: number, runs = 0, submittedRuns = 0) => ({ day: d, helpful, notHelpful: 1, needsRatings: 2, runs, submittedRuns });

test("a week starts on its Monday", () => {
  expect(bucketKey("2026-10-29", "weekly")).toBe("2026-10-26");
  expect(bucketKey("2026-10-26", "weekly")).toBe("2026-10-26");
  expect(bucketKey("2026-11-01", "weekly")).toBe("2026-10-26");
});

test("weeks add up their days and leave out the running week", () => {
  const buckets = noteBuckets([day("2026-10-20", 1, 5, 2), day("2026-10-21", 2), day("2026-10-27", 3)], "weekly", "2026-10-29");
  expect(buckets).toHaveLength(1);
  expect(buckets[0]).toMatchObject({ key: "2026-10-19", helpful: 3, notHelpful: 2, needsRatings: 4, notSubmittedRuns: 3 });
});

test("days keep today", () => {
  expect(noteBuckets([day("2026-10-29", 1)], "daily", "2026-10-29").map((b) => b.key)).toEqual(["2026-10-29"]);
});

test("human notes are what is left of the helpful notes, never below zero", () => {
  const [a, b] = originBuckets(
    [
      { day: "2026-10-20", total: 10, ours: 2, otherAi: 3 },
      { day: "2026-10-21", total: 1, ours: 1, otherAi: 1 },
    ],
    "daily",
    "2026-10-29",
  );
  expect(a!.human).toBe(5);
  expect(b!.human).toBe(0);
});
