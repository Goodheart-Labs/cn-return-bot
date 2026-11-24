import { describe, expect, test } from "bun:test";
import { LIMIT_COOLDOWN_MS, limitAfterSuccess, roomForChecks } from "./room";

const now = new Date("2026-11-23T12:00:00Z");

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
