import { describe, expect, it } from "bun:test";
import { fetchFeedPosts } from "./substack";

const FEED = `<?xml version="1.0"?><rss><channel>
<title><![CDATA[Don't Worry About the Vase]]></title>
<image><url>https://substackcdn.com/image/fetch/logo.png</url><title>Don't Worry About the Vase</title></image>
<item><title><![CDATA[AI #176]]></title><link>https://thezvi.substack.com/p/ai-176</link><pubDate>Thu, 09 Jul 2026 12:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Body</p>]]></content:encoded></item>
</channel></rss>`;

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
