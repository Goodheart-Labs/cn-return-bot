import { describe, expect, test } from "bun:test";
import { type ClaudePacing, silenceNotice } from "./usagePacing";

const silent = (lastReadingAt: Date | null): ClaudePacing => ({ kind: "runner_silent", reason: "silent", lastReadingAt });
const paced: ClaudePacing = {
  kind: "paced",
  weekly: 30,
  resetsAt: new Date("2026-11-08T11:30:00Z"),
  usagePerPost: 0.1,
  usagePerPostIsDefault: false,
  intervalMs: 60_000,
  dueAt: new Date("2026-11-03T10:00:00Z"),
};
const lastReading = new Date("2026-11-03T09:00:00Z");

describe("silenceNotice", () => {
  test("warns when the note writer first goes silent", () => {
    expect(silenceNotice(silent(lastReading), null)).toEqual({ kind: "warn", newestReadingAt: lastReading });
  });

  test("stays quiet on later runs of the same outage", () => {
    expect(silenceNotice(silent(lastReading), lastReading)).toBeNull();
  });

  test("warns again when the note writer came back briefly and went silent again", () => {
    const later = new Date("2026-11-03T12:00:00Z");
    expect(silenceNotice(silent(later), lastReading)).toEqual({ kind: "warn", newestReadingAt: later });
  });

  test("warns only once when there is no reading at all", () => {
    const notice = silenceNotice(silent(null), null);
    expect(notice?.kind).toBe("warn");
    expect(silenceNotice(silent(null), notice?.kind === "warn" ? notice.newestReadingAt : null)).toBeNull();
  });

  test("says the note writer is back once it reports again", () => {
    expect(silenceNotice(paced, lastReading)).toEqual({ kind: "back" });
  });

  test("says nothing while the note writer reports and no warning is outstanding", () => {
    expect(silenceNotice(paced, null)).toBeNull();
  });
});
