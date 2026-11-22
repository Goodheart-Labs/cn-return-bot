import { describe, expect, test } from "bun:test";
import { computeMaxPosts, MAX_POSTS_CAP } from "./computeMaxPosts";

const capacity = { cap: 40, used24h: 37, inFlight: 0, remaining: 3, reserve: 0,
  canSubmit: true, probe: false, signalQueued: 0, nextAttemptAt: null };
/** One check in eight ends in a note. */
const recent = { checked: 400, noted: 50 };

describe("how many tweets an X run checks", () => {
  test("enough to fill the room left, with a margin", () => {
    // 3 notes of room, 8 checks per note, times 1.25.
    expect(computeMaxPosts({ ...capacity, remaining: 1 }, recent, 0)).toBe(10);
    expect(computeMaxPosts(capacity, recent, 0)).toBe(MAX_POSTS_CAP);
  });
  test("none when the room is full", () => {
    expect(computeMaxPosts({ ...capacity, remaining: 0 }, recent, 0)).toBe(0);
  });
  test("queued notes fill the room first", () => {
    expect(computeMaxPosts(capacity, recent, 2)).toBe(10);
    expect(computeMaxPosts(capacity, recent, 3)).toBe(0);
  });
  test("a cooldown probe has room for one note, which a queued note fills", () => {
    const probe = { ...capacity, remaining: 0, probe: true };
    expect(computeMaxPosts(probe, recent, 0)).toBe(10);
    expect(computeMaxPosts(probe, recent, 1)).toBe(0);
  });
  test("none while X refuses or a Signal note waits", () => {
    expect(computeMaxPosts({ ...capacity, canSubmit: false }, recent, 0)).toBe(0);
    expect(computeMaxPosts({ ...capacity, signalQueued: 1 }, recent, 0)).toBe(0);
  });
  test("the full batch when the room or the share of checks with a note is unknown", () => {
    expect(computeMaxPosts({ ...capacity, cap: null, remaining: null }, recent, 0)).toBe(MAX_POSTS_CAP);
    expect(computeMaxPosts({ ...capacity, remaining: 1 }, { checked: 10, noted: 2 }, 0)).toBe(MAX_POSTS_CAP);
    expect(computeMaxPosts({ ...capacity, remaining: 1 }, { checked: 400, noted: 0 }, 0)).toBe(MAX_POSTS_CAP);
  });
});
