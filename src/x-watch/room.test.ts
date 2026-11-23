import { describe, expect, test } from "bun:test";
import type { Post } from "../api/fetchEligiblePosts";
import { LIMIT_COOLDOWN_MS, limitAfterSuccess, pickNewPosts, roomForChecks } from "./room";

const now = new Date("2026-11-23T12:00:00Z");

const post = (id: string, createdAt: string, sensitive = false): Post => ({
  id,
  author_id: "1",
  created_at: createdAt,
  text: "A post",
  media: [],
  raw: { possibly_sensitive: sensitive, includes: { author: null, media: [], referenced_tweets: [], polls: [], place: null } },
});

describe("roomForChecks", () => {
  test("writes only as many test notes as were allowed", () => {
    expect(roomForChecks({ kind: "testing", testNotesSubmitted: 0, testNoteAllowance: 0 }, 0, now)).toBe(0);
    expect(roomForChecks({ kind: "testing", testNotesSubmitted: 0, testNoteAllowance: 5 }, 0, now)).toBe(5);
    expect(roomForChecks({ kind: "testing", testNotesSubmitted: 3, testNoteAllowance: 5 }, 1, now)).toBe(1);
    expect(roomForChecks({ kind: "testing", testNotesSubmitted: 5, testNoteAllowance: 5 }, 0, now)).toBe(0);
  });

  test("leaves room for the writing limit minus the day's notes and the open ones", () => {
    expect(roomForChecks({ kind: "admitted", writingLimit: 10, submittedLast24h: 6, limitHitAt: null }, 2, now)).toBe(2);
    expect(roomForChecks({ kind: "admitted", writingLimit: 10, submittedLast24h: 9, limitHitAt: null }, 3, now)).toBe(0);
  });

  test("checks nothing right after X refused a note for the daily limit", () => {
    const limitHitAt = new Date(now.getTime() - LIMIT_COOLDOWN_MS + 60_000);
    expect(roomForChecks({ kind: "admitted", writingLimit: 12, submittedLast24h: 3, limitHitAt }, 0, now)).toBe(0);
    const longAgo = new Date(now.getTime() - LIMIT_COOLDOWN_MS - 60_000);
    expect(roomForChecks({ kind: "admitted", writingLimit: 12, submittedLast24h: 3, limitHitAt: longAgo }, 0, now)).toBe(9);
  });
});

test("an accepted note at the limit raises it by one, so the next post tests a larger limit", () => {
  expect(limitAfterSuccess(10, 10)).toBe(11);
  expect(limitAfterSuccess(10, 4)).toBe(10);
});

describe("pickNewPosts", () => {
  const posts = [post("1", "2026-11-23T08:00:00Z"), post("2", "2026-11-23T11:00:00Z"), post("3", "2026-11-23T10:00:00Z"), post("2", "2026-11-23T11:00:00Z")];

  test("takes the newest unhandled posts first, each once", () => {
    expect(pickNewPosts(posts, new Set(), 5).map((p) => p.id)).toEqual(["2", "3", "1"]);
    expect(pickNewPosts(posts, new Set(["2"]), 1).map((p) => p.id)).toEqual(["3"]);
  });

  test("leaves out posts X marked as possibly sensitive", () => {
    expect(pickNewPosts([post("4", "2026-11-23T11:30:00Z", true), ...posts], new Set(), 1).map((p) => p.id)).toEqual(["2"]);
  });

  test("takes nothing without room", () => {
    expect(pickNewPosts(posts, new Set(), 0)).toEqual([]);
  });
});
