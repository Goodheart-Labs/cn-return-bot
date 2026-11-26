import { describe, expect, test } from "bun:test";
import type { Post } from "../api/fetchEligiblePosts";
import { pickPosts } from "./pick";

const post = (id: string, sensitive = false): Post => ({
  id,
  author_id: "1",
  created_at: "2026-11-24T10:00:00Z",
  text: "A post",
  media: [],
  raw: { possibly_sensitive: sensitive, includes: { author: null, media: [], referenced_tweets: [], polls: [], place: null } },
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
