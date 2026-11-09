import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { canonicalFeed, canonicalLesswrongFeed } from "../../../everything/feedUrls";
import * as client from "../../../service/client";
import type { ApiAnswer } from "../../../service/contract";
import { forumOrigin, parseAuthorFeedUrl, parsePostUrl, readForumAuthor } from "./forum";

/* These tests cover the URL parsing and what the listing keeps. The real
 * GraphQL answers are exercised against the live sites by running the enqueue
 * and auto-enqueue commands. */

describe("forumOrigin", () => {
  test("each forum resolves to its canonical origin", () => {
    expect(forumOrigin("https://lesswrong.com/posts/abc/x")).toBe("https://www.lesswrong.com");
    expect(forumOrigin("https://www.alignmentforum.org/users/zvi")).toBe("https://www.alignmentforum.org");
    expect(forumOrigin("https://forum.effectivealtruism.org/posts/abc/x")).toBe("https://forum.effectivealtruism.org");
  });

  test("other hosts and junk give null", () => {
    expect(forumOrigin("https://example.com/posts/abc")).toBeNull();
    expect(forumOrigin("https://notlesswrong.com/posts/abc")).toBeNull();
    expect(forumOrigin("https://effectivealtruism.org/posts/abc")).toBeNull();
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

  test("an EA Forum author keeps the host without www, which migration 179 accepts", () => {
    expect(canonicalLesswrongFeed("https://forum.effectivealtruism.org/users/Toby-Tremlett")?.feed_url).toBe("https://forum.effectivealtruism.org/users/toby-tremlett");
  });

  test("canonicalFeed recognizes a forum author alongside the other feed types", () => {
    expect(canonicalFeed("https://www.alignmentforum.org/users/zvi")?.feed_type).toBe("lesswrong");
    expect(canonicalFeed("https://thezvi.substack.com")?.feed_type).toBe("substack");
    expect(canonicalFeed("https://www.lesswrong.com/posts/abc/x")).toBeNull();
  });
});

describe("readForumAuthor", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

  const graphqlAnswer = (data: object): ApiAnswer => ({ type: "answer", body: JSON.stringify({ data }) });
  const post = (id: string, fmCrosspost: object | null) => ({ _id: id, pageUrl: `https://forum.effectivealtruism.org/posts/${id}`, title: id, postedAt: "2026-11-01T00:00:00Z", htmlBody: "<p>Body</p>", fmCrosspost });

  test("leaves out a copy of a post whose original lives on the other forum, and uses the EA Forum's picture account", async () => {
    const answers = [
      graphqlAnswer({ user: { result: { _id: "u1", displayName: "Toby", profileImageId: "Profile/abc" } } }),
      graphqlAnswer({ posts: { results: [post("own", null), post("copy", { isCrosspost: true, hostedHere: false }), post("original", { isCrosspost: true, hostedHere: true })] } }),
    ];
    spies.push(spyOn(client, "askFetcher").mockImplementation((async () => answers.shift()!) as typeof client.askFetcher));
    const listing = await readForumAuthor({ origin: "https://forum.effectivealtruism.org", slug: "toby" }, 3);
    expect(listing.posts.map((p) => p.postId)).toEqual(["own", "original"]);
    expect(listing.imageUrl).toBe("https://res.cloudinary.com/cea/image/upload/c_crop,g_custom/c_fill,dpr_2,q_100,f_auto,g_auto:faces,w_96,h_96,b_white/Profile/abc");
  });
});
