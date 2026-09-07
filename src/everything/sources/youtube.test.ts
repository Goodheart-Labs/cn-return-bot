import { describe, expect, test } from "bun:test";
import { parseChannelListing } from "./youtube";

/* The listing parser is what turns one yt-dlp call into dated candidates, so
 * it is pinned against the exact lines yt-dlp prints. The sample is Hank
 * Green's /videos tab as printed on 2026-09-07 with approximate_date on. */

const printed = [
  "ht6apJ2nG6k\t480.0\t20260905\tAnswering Your Cancer Questions",
  "1Q1d9wxw0s4\t612.0\t20260902\tThe Most Important Thing that Ever Happened",
  "premiere123\tNA\tNA\tA premiere that has not aired yet",
  "Hank Green",
].join("\n");

describe("parseChannelListing", () => {
  test("reads id, duration, approximate upload day and title, and the channel name last", () => {
    const { channelName, videos } = parseChannelListing(printed, "https://www.youtube.com/@hankschannel");
    expect(channelName).toBe("Hank Green");
    expect(videos[0]).toEqual({
      videoId: "ht6apJ2nG6k",
      url: "https://www.youtube.com/watch?v=ht6apJ2nG6k",
      title: "Answering Your Cancer Questions",
      durationSeconds: 480,
      uploadDate: "2026-09-05",
    });
  });

  test("a premiere has no duration and no date, and both come through as absent", () => {
    const { videos } = parseChannelListing(printed, "x");
    expect(videos[2]!.durationSeconds).toBeNull();
    expect(videos[2]!.uploadDate).toBeUndefined();
  });

  test("a title containing a tab keeps all of its parts", () => {
    const { videos } = parseChannelListing("abc12345678\t10.0\t20260101\tpart one\tpart two\nName", "x");
    expect(videos[0]!.title).toBe("part one part two");
  });

  test("a missing channel line leaves the name undefined without eating a video", () => {
    const { channelName, videos } = parseChannelListing("abc12345678\t10.0\t20260101\tOnly video", "x");
    expect(channelName).toBeUndefined();
    expect(videos).toHaveLength(1);
  });

  test("an empty listing fails loudly, because a videos tab is never empty", () => {
    expect(() => parseChannelListing("", "https://www.youtube.com/@x")).toThrow(/zero videos/);
  });
});
