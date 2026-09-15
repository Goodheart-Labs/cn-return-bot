import { describe, expect, test } from "bun:test";
import { parseChannelFeedDates, parseChannelListing } from "./youtube";

/* The listing parser turns one yt-dlp call into candidates, so it is pinned
 * against the exact lines yt-dlp prints. The sample is Hank Green's /videos
 * tab as printed on 2026-09-07. */

const printed = [
  "ht6apJ2nG6k\t480.0\tAnswering Your Cancer Questions",
  "1Q1d9wxw0s4\t612.0\tThe Most Important Thing that Ever Happened",
  "premiere123\tNA\tA premiere that has not aired yet",
  "Hank Green",
].join("\n");

describe("parseChannelListing", () => {
  test("reads id, duration and title, and the channel name last", () => {
    const { channelName, videos } = parseChannelListing(printed, "https://www.youtube.com/@hankschannel");
    expect(channelName).toBe("Hank Green");
    expect(videos[0]).toEqual({
      videoId: "ht6apJ2nG6k",
      url: "https://www.youtube.com/watch?v=ht6apJ2nG6k",
      title: "Answering Your Cancer Questions",
      durationSeconds: 480,
    });
  });

  test("a premiere has no duration, which comes through as null", () => {
    const { videos } = parseChannelListing(printed, "x");
    expect(videos[2]!.durationSeconds).toBeNull();
  });

  test("a title containing a tab keeps all of its parts", () => {
    const { videos } = parseChannelListing("abc12345678\t10.0\tpart one\tpart two\nName", "x");
    expect(videos[0]!.title).toBe("part one part two");
  });

  test("a missing channel line leaves the name undefined without eating a video", () => {
    const { channelName, videos } = parseChannelListing("abc12345678\t10.0\tOnly video", "x");
    expect(channelName).toBeUndefined();
    expect(videos).toHaveLength(1);
  });

  test("the channel id, printed after the name, is read and does not eat the name", () => {
    const { channelName, channelId, videos } = parseChannelListing(`${printed}\nUCsXVk37bltHxD1rDPwtNM8Q`, "x");
    expect(channelId).toBe("UCsXVk37bltHxD1rDPwtNM8Q");
    expect(channelName).toBe("Hank Green");
    expect(videos).toHaveLength(3);
  });

  test("an empty listing fails loudly, because a videos tab is never empty", () => {
    expect(() => parseChannelListing("", "https://www.youtube.com/@x")).toThrow(/zero videos/);
  });
});

describe("parseChannelFeedDates", () => {
  test("reads each entry's video id and publish day from a channel feed", () => {
    const xml = [
      '<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">',
      "<published>2013-01-12T01:40:14+00:00</published>",
      "<entry><yt:videoId>abc12345678</yt:videoId><published>2026-09-14T17:00:03+00:00</published></entry>",
      "<entry><yt:videoId>def12345678</yt:videoId><published>2026-09-10T17:00:08+00:00</published></entry>",
      "<entry><yt:videoId>nodate12345</yt:videoId></entry>",
      "</feed>",
    ].join("\n");
    // The feed's own published date, before the first entry, is not a video.
    expect([...parseChannelFeedDates(xml)]).toEqual([
      ["abc12345678", "2026-09-14"],
      ["def12345678", "2026-09-10"],
    ]);
  });
});
