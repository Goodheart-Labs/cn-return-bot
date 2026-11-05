import { describe, expect, test } from "bun:test";
import type { WatchedNotewriter } from "./db";
import { isSilent, NEVER_SEEN, silenceNotice } from "./notewriterSilence";

const NOW = new Date("2026-11-05T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const notewriter = (overrides: Partial<WatchedNotewriter> = {}): WatchedNotewriter => ({
  id: "friend-bot",
  name: "Friend",
  owner: "A friend",
  every_minutes: 20,
  takes_reader_requests: false,
  last_seen_at: minutesAgo(31),
  silence_warned_for: null,
  holdsPost: false,
  ...overrides,
});

describe("isSilent", () => {
  test("a subscribed notewriter that has not asked for 30 minutes is silent", () => {
    expect(isSilent(notewriter(), NOW)).toBe(true);
  });

  test("one that asked recently is not", () => {
    expect(isSilent(notewriter({ last_seen_at: minutesAgo(5) }), NOW)).toBe(false);
  });

  test("one that holds a post is busy, not silent", () => {
    expect(isSilent(notewriter({ holdsPost: true }), NOW)).toBe(false);
  });

  test("one with nothing to take is not silent", () => {
    expect(isSilent(notewriter({ every_minutes: null }), NOW)).toBe(false);
    expect(isSilent(notewriter({ every_minutes: null, takes_reader_requests: true }), NOW)).toBe(true);
  });

  test("the pipeline is never silent, because the feed run is its worker", () => {
    expect(isSilent(notewriter({ id: "pipeline", last_seen_at: null }), NOW)).toBe(false);
  });
});

describe("silenceNotice", () => {
  const lastSeen = new Date(minutesAgo(40));

  test("warns when the notewriter first goes silent", () => {
    expect(silenceNotice(true, lastSeen, null)).toEqual({ kind: "warn", lastSeenAt: lastSeen });
  });

  test("stays quiet on later runs of the same silence", () => {
    expect(silenceNotice(true, lastSeen, lastSeen)).toBeNull();
  });

  test("warns again when the notewriter came back briefly and went silent again", () => {
    const later = new Date(minutesAgo(35));
    expect(silenceNotice(true, later, lastSeen)).toEqual({ kind: "warn", lastSeenAt: later });
  });

  test("warns only once about a notewriter that never asked", () => {
    expect(silenceNotice(true, null, null)).toEqual({ kind: "warn", lastSeenAt: NEVER_SEEN });
    expect(silenceNotice(true, null, NEVER_SEEN)).toBeNull();
  });

  test("says the notewriter is back once it asks again", () => {
    expect(silenceNotice(false, lastSeen, lastSeen)).toEqual({ kind: "back" });
  });

  test("says nothing while the notewriter asks and no warning is outstanding", () => {
    expect(silenceNotice(false, lastSeen, null)).toBeNull();
  });
});
