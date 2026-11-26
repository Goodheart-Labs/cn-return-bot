import { describe, expect, test } from "bun:test";
import { postsPerDay, viewsThreshold } from "./viewsThreshold";

const MIN_NOTE_RATE = 0.05;

describe("viewsThreshold", () => {
  // 280 posts arrived in 7 days with the scores 280,000, 279,000, ..., 1,000.
  const week = { hours: 7 * 24, bestScores: Array.from({ length: 280 }, (_, i) => (280 - i) * 1000) };

  test("lets through as many posts as fill the limit at the note rate", () => {
    // 10 notes a day at a note rate of 0.2 take 50 posts a day, so 350 in the
    // week, more than arrived: every post with a score goes.
    expect(postsPerDay(10, 0.2, MIN_NOTE_RATE)).toBe(50);
    expect(viewsThreshold(week, 50)).toBe(0);
    // 20 posts a day are the 140 best of the week.
    expect(viewsThreshold(week, 20)).toBe(141_000);
  });

  test("counts the posts of a shorter history as posts per hour", () => {
    // 6 hours with 40 posts: 20 posts a day are the 5 best of those.
    const history = { hours: 6, bestScores: Array.from({ length: 40 }, (_, i) => (40 - i) * 1000) };
    expect(viewsThreshold(history, 20)).toBe(36_000);
  });

  test("sets no threshold while the history is too short", () => {
    expect(viewsThreshold({ hours: 1, bestScores: [5000] }, 20)).toBeNull();
  });

  test("a very low note rate does not let every post through", () => {
    expect(postsPerDay(10, 0, MIN_NOTE_RATE)).toBe(200);
  });
});
