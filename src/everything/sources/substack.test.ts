import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readListing } from "../../pipeline/fetch/readListing";
import { fetchFeedPosts, mostLikedArchivePosts } from "./substack";

const FEED = `<?xml version="1.0"?><rss><channel>
<title><![CDATA[Don't Worry About the Vase]]></title>
<image><url>https://substackcdn.com/image/fetch/logo.png</url><title>Don't Worry About the Vase</title></image>
<item><title><![CDATA[AI #176]]></title><link>https://thezvi.substack.com/p/ai-176</link><pubDate>Thu, 09 Jul 2026 12:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Body</p>]]></content:encoded></item>
</channel></rss>`;

// In GitHub Actions the feed would be asked of the services machine. These
// tests fetch it in this process, so they run the same everywhere.
const ciVariable = process.env.GITHUB_ACTIONS;
beforeEach(() => delete process.env.GITHUB_ACTIONS);
afterEach(() => {
  if (ciVariable !== undefined) process.env.GITHUB_ACTIONS = ciVariable;
});

describe("fetchFeedPosts", () => {
  it("reads the publication's name and logo from the channel, not from an item", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(FEED)) as unknown as typeof fetch;
    try {
      const feed = await fetchFeedPosts("https://thezvi.substack.com");
      expect(feed.title).toBe("Don't Worry About the Vase");
      expect(feed.imageUrl).toBe("https://substackcdn.com/image/fetch/logo.png");
      expect(feed.posts.map((p) => p.url)).toEqual(["https://thezvi.substack.com/p/ai-176"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("readListing", () => {
  it("lists only a feed in the form we store, so it cannot fetch any other address", async () => {
    await expect(readListing({ feedUrl: "https://example.com", limit: 3 })).rejects.toThrow("Not a feed we list");
    await expect(readListing({ feedUrl: "https://thezvi.substack.com/api/v1/archive", limit: 3 })).rejects.toThrow("Not a feed we list");
  });
});

describe("the archive API's top sort", () => {
  const post = (title: string, likes: number, audience = "everyone") => ({
    title,
    audience,
    type: "newsletter",
    canonical_url: `https://thezvi.substack.com/p/${title}`,
    post_date: "2026-11-01T12:00:00.000Z",
    reactions: { "❤": likes },
  });

  it("reads the posts out of the answer's posts list, most liked free post first", () => {
    const answer = { posts: [post("a", 5), post("b", 40), post("paid", 900, "only_paid")] };
    expect(mostLikedArchivePosts(answer, 2).map((p) => [p.title, p.likes])).toEqual([
      ["b", 40],
      ["a", 5],
    ]);
  });

  it("fails loudly on an answer without a posts list, such as the bare list Substack sent until November 2026", () => {
    expect(() => mostLikedArchivePosts([post("a", 5)], 1)).toThrow("without a list of posts");
  });
});
