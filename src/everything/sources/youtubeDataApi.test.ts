import { describe, expect, it } from "bun:test";
import { longFormUploadsPlaylist, parseIsoDuration } from "./youtubeDataApi";

describe("parseIsoDuration", () => {
  it("handles hours, minutes, seconds and the empty duration of a live stream", () => {
    expect(parseIsoDuration("PT2H14M45S")).toBe(2 * 3600 + 14 * 60 + 45);
    expect(parseIsoDuration("PT21M41S")).toBe(21 * 60 + 41);
    expect(parseIsoDuration("PT59S")).toBe(59);
    expect(parseIsoDuration("P1DT1S")).toBe(86401);
    expect(parseIsoDuration("P0D")).toBe(0);
    expect(parseIsoDuration("")).toBe(0);
  });
});

describe("longFormUploadsPlaylist", () => {
  it("swaps the channel prefix for the long-form uploads prefix", () => {
    expect(longFormUploadsPlaylist("UCzQUP1qoWDoEbmsQxvdjxgQ")).toBe("UULFzQUP1qoWDoEbmsQxvdjxgQ");
  });
});
