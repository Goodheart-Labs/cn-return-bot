import { describe, expect, test } from "bun:test";
import type { Post } from "../../../api/fetchEligiblePosts";
import { buildUserMessage } from "./userMessage";

const postWithId = (id: string): Post => ({ id, author_id: "unknown", created_at: "2026-09-24T12:00:00+00:00", text: "Highlighted claim from Article: x", media: [] }) as Post;
const messageOf = (post: Post) => buildUserMessage({ post, tweetMedia: [], quotedTweetMedia: [] });

describe("buildUserMessage", () => {
  test("gives a real tweet its posting date, its age and its address", () => {
    const message = messageOf(postWithId("1234567890"));
    expect(message).toContain("Tweet posted: 2026-09-24T12:00:00+00:00");
    expect(message).toContain("Post age: ");
    expect(message).toContain("Tweet URL: https://x.com/i/status/1234567890");
  });

  test("gives a claim from an article or a video no tweet wording", () => {
    const message = messageOf(postWithId("3a030aad-0"));
    expect(message).not.toContain("Tweet posted");
    expect(message).not.toContain("Post age");
    expect(message).not.toContain("Tweet URL");
    expect(message).toContain("Highlighted claim from Article: x");
  });
});
