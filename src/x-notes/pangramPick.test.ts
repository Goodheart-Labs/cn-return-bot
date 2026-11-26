import { describe, expect, test } from "bun:test";
import type { Post } from "../api/fetchEligiblePosts";
import type { Reading } from "../feed-views/walk";
import { addScores, type BestScore, longFormScored, pickForPangram, scoreHistory } from "./pangramPick";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const HOUR = 3_600_000;
const LONG_TEXT = "x".repeat(281);

function reading(id: string, opts: { text?: string; sensitive?: boolean } = {}): Reading {
  const post = {
    id, author_id: "a", created_at: "2026-11-25T10:00:00Z", text: opts.text ?? LONG_TEXT, media: [],
    raw: { possibly_sensitive: opts.sensitive ?? false, includes: { referenced_tweets: [] } },
  } as unknown as Post;
  return { post, observedAt: new Date(NOW), tier: "xl", xlRank: 1 };
}

describe("longFormScored", () => {
  test("keeps long-form posts with a positive score that X did not mark as possibly sensitive", () => {
    const readings = [reading("long"), reading("short", { text: "short" }), reading("sensitive", { sensitive: true }), reading("unscored"), reading("zero")];
    const scores = new Map<string, number | null>([["long", 5000], ["short", 9000], ["sensitive", 9000], ["unscored", null], ["zero", 0]]);
    expect(longFormScored(readings, scores).map((s) => s.post.id)).toEqual(["long"]);
  });
});

describe("addScores", () => {
  test("returns only new posts and posts that beat their best, and keeps the first sighting", () => {
    const history = new Map<string, BestScore>([["seen", { firstSeenAt: NOW - HOUR, best: 1000 }], ["worse", { firstSeenAt: NOW - HOUR, best: 9000 }]]);
    const scored = [
      { post: reading("seen").post, tier: "xl" as const, viewsToCome: 2000 },
      { post: reading("worse").post, tier: "xl" as const, viewsToCome: 8000 },
      { post: reading("new").post, tier: "xl" as const, viewsToCome: 500 },
    ];
    expect(addScores(history, scored, NOW)).toEqual([["seen", { firstSeenAt: NOW - HOUR, best: 2000 }], ["new", { firstSeenAt: NOW, best: 500 }]]);
    expect(history.get("worse")!.best).toBe(9000);
  });
});

describe("scoreHistory", () => {
  test("lists the last 7 days best first and forgets older posts", () => {
    const history = new Map<string, BestScore>([
      ["old", { firstSeenAt: NOW - 8 * 24 * HOUR, best: 99_000 }],
      ["a", { firstSeenAt: NOW - 48 * HOUR, best: 1000 }],
      ["b", { firstSeenAt: NOW - HOUR, best: 3000 }],
    ]);
    expect(scoreHistory(history, NOW)).toEqual({ hours: 48, bestScores: [3000, 1000] });
    expect(history.has("old")).toBe(false);
  });
});

describe("pickForPangram", () => {
  const scored = ([["low", 1000], ["best", 9000], ["good", 5000]] as const).map(([id, viewsToCome]) => ({ post: reading(id).post, tier: "xl" as const, viewsToCome }));

  test("takes the best posts at the threshold or above that were not checked, up to the limit", () => {
    expect(pickForPangram(scored, new Set(), 2000, 10).map((s) => s.post.id)).toEqual(["best", "good"]);
    expect(pickForPangram(scored, new Set(["best"]), 0, 2).map((s) => s.post.id)).toEqual(["good", "low"]);
  });
});
