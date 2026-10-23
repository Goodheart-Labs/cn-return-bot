import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { fetchFeedPosts, fetchFeedXmlDirectly } from "./substack";

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

describe("fetchFeedXmlDirectly", () => {
  it("refuses any address that is not a publication's feed", async () => {
    await expect(fetchFeedXmlDirectly("https://example.com/feed")).rejects.toThrow("Not a Substack feed URL");
    await expect(fetchFeedXmlDirectly("https://thezvi.substack.com/api/v1/archive")).rejects.toThrow("Not a Substack feed URL");
  });
});
