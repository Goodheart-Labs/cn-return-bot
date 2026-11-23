import { describe, expect, test } from "bun:test";
import { isPossiblySensitive, parsePostsResponse } from "./fetchEligiblePosts";

const quoted = { id: "2", text: "The quoted post.", author_id: "7", created_at: "2026-11-20T10:00:00Z" };

/** One feed answer with one post that quotes another, as X sends it. */
function feedPost(flags: { own: boolean; quoted: boolean }) {
  const [post] = parsePostsResponse({
    data: [{ id: "1", text: "A post.", author_id: "42", created_at: "2026-11-20T12:00:00Z", possibly_sensitive: flags.own, referenced_tweets: [{ type: "quoted", id: "2" }] }],
    includes: { tweets: [{ ...quoted, possibly_sensitive: flags.quoted }] },
  });
  return post!;
}

describe("isPossiblySensitive", () => {
  test("a post X marked is sensitive", () => {
    expect(isPossiblySensitive(feedPost({ own: true, quoted: false }))).toBe(true);
  });

  test("a post that quotes a marked post is sensitive", () => {
    expect(isPossiblySensitive(feedPost({ own: false, quoted: true }))).toBe(true);
  });

  test("a post where neither is marked is not", () => {
    expect(isPossiblySensitive(feedPost({ own: false, quoted: false }))).toBe(false);
  });
});
