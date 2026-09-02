import { describe, expect, test } from "bun:test";
import { canonicalFeed, canonicalLesswrongFeed } from "../feedUrls";
import { forumOrigin, parseAuthorFeedUrl, parsePostUrl } from "./lesswrong";

/* These tests cover the URL parsing only. The GraphQL fetches are exercised
 * against the live sites by running the enqueue and auto-enqueue commands. */

describe("forumOrigin", () => {
  test("both sites resolve to their canonical www origin", () => {
    expect(forumOrigin("https://lesswrong.com/posts/abc/x")).toBe("https://www.lesswrong.com");
    expect(forumOrigin("https://www.alignmentforum.org/users/zvi")).toBe("https://www.alignmentforum.org");
  });

  test("other hosts and junk give null", () => {
    expect(forumOrigin("https://example.com/posts/abc")).toBeNull();
    expect(forumOrigin("https://notlesswrong.com/posts/abc")).toBeNull();
    expect(forumOrigin("not a url")).toBeNull();
  });
});

describe("parseAuthorFeedUrl", () => {
  test("a profile URL gives origin and slug", () => {
    expect(parseAuthorFeedUrl("https://www.lesswrong.com/users/eliezer_yudkowsky")).toEqual({
      origin: "https://www.lesswrong.com",
      slug: "eliezer_yudkowsky",
    });
  });

  test("post pages and profile subpages are not author feeds", () => {
    expect(parseAuthorFeedUrl("https://www.lesswrong.com/posts/abc/some-title")).toBeNull();
    expect(parseAuthorFeedUrl("https://www.lesswrong.com/users/zvi/replies")).toBeNull();
  });
});

describe("parsePostUrl", () => {
  test("a post URL gives origin and post id, with or without the title slug", () => {
    expect(parsePostUrl("https://www.lesswrong.com/posts/KgwQchapx4vJDhfYC/generalized-atheism")).toEqual({
      origin: "https://www.lesswrong.com",
      postId: "KgwQchapx4vJDhfYC",
    });
    expect(parsePostUrl("https://www.alignmentforum.org/posts/KgwQchapx4vJDhfYC")).toEqual({
      origin: "https://www.alignmentforum.org",
      postId: "KgwQchapx4vJDhfYC",
    });
  });

  test("profile pages are not posts", () => {
    expect(parsePostUrl("https://www.lesswrong.com/users/zvi")).toBeNull();
  });
});

describe("canonicalLesswrongFeed", () => {
  test("normalizes host and slug casing", () => {
    expect(canonicalLesswrongFeed("https://lesswrong.com/users/Zvi/")).toEqual({
      project_slug: "zvi",
      feed_type: "lesswrong",
      feed_url: "https://www.lesswrong.com/users/zvi",
    });
  });

  test("canonicalFeed recognizes a forum author alongside the other feed types", () => {
    expect(canonicalFeed("https://www.alignmentforum.org/users/zvi")?.feed_type).toBe("lesswrong");
    expect(canonicalFeed("https://thezvi.substack.com")?.feed_type).toBe("substack");
    expect(canonicalFeed("https://www.lesswrong.com/posts/abc/x")).toBeNull();
  });
});
