import { describe, expect, test } from "bun:test";
import type { Post } from "../api/fetchEligiblePosts";
import { pickPosts, postsPerDay, viewsThreshold } from "./pick";

const post = (id: string, sensitive = false): Post => ({
  id,
  author_id: "1",
  created_at: "2026-11-24T10:00:00Z",
  text: "A post",
  media: [],
  raw: { possibly_sensitive: sensitive, includes: { author: null, media: [], referenced_tweets: [], polls: [], place: null } },
});

describe("viewsThreshold", () => {
  // 280 posts arrived in 7 days with the scores 280,000, 279,000, ..., 1,000.
  const week = { hours: 7 * 24, bestScores: Array.from({ length: 280 }, (_, i) => (280 - i) * 1000) };

  test("lets through as many posts as fill the limit at the note rate", () => {
    // 10 notes a day at a note rate of 0.2 take 50 posts a day, so 350 in the
    // week, more than arrived: every post with a score goes.
    expect(postsPerDay(10, 0.2)).toBe(50);
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
    expect(postsPerDay(10, 0)).toBe(200);
  });
});

describe("pickPosts", () => {
  const scored = [
    { post: post("low"), viewsToCome: 5_000 },
    { post: post("best"), viewsToCome: 90_000 },
    { post: post("good"), viewsToCome: 40_000 },
    { post: post("zero"), viewsToCome: 0 },
    { post: post("sensitive", true), viewsToCome: 99_000 },
  ];

  test("takes the best posts at the threshold or above, within the room", () => {
    expect(pickPosts(scored, new Set(), 5, 10_000).map((s) => s.post.id)).toEqual(["best", "good"]);
    expect(pickPosts(scored, new Set(), 1, 10_000).map((s) => s.post.id)).toEqual(["best"]);
  });

  test("skips posts handled before, posts X marked as possibly sensitive, and posts without views to come", () => {
    expect(pickPosts(scored, new Set(["best"]), 5, 0).map((s) => s.post.id)).toEqual(["good", "low"]);
  });

  test("takes nothing without room", () => {
    expect(pickPosts(scored, new Set(), 0, 0)).toEqual([]);
  });
});
