import { describe, expect, mock, test } from "bun:test";
import { dbMock } from "./dbMock";

mock.module("./db", dbMock);

const { listingReason } = await import("./youtubeChannels");

/* Covers when the walk asks the Data API about a channel again: never listed,
 * notified since the last listing, or a listing a day old. Otherwise the
 * stored listing is used. */
describe("listingReason", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  const row = (listed_at: string | null, notified_at: string | null) => ({ listed_at, notified_at });

  test("a channel with no row or no listing yet is listed", () => {
    expect(listingReason(null, now)).toBe("first");
    expect(listingReason(row(null, null), now)).toBe("first");
  });

  test("a notification after the last listing makes the channel due", () => {
    expect(listingReason(row("2026-09-29T11:00:00Z", "2026-09-29T11:30:00Z"), now)).toBe("notified");
  });

  test("a notification before the last listing was already seen by that listing", () => {
    expect(listingReason(row("2026-09-29T11:00:00Z", "2026-09-29T10:00:00Z"), now)).toBeNull();
  });

  test("a listing older than a day is repeated without any notification", () => {
    expect(listingReason(row("2026-09-28T11:59:00Z", null), now)).toBe("day old");
    expect(listingReason(row("2026-09-28T12:01:00Z", null), now)).toBeNull();
  });
});
