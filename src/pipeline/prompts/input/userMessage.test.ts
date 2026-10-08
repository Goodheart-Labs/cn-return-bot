import { describe, expect, test } from "bun:test";
import type { Post } from "../../../api/fetchEligiblePosts";
import { DEFAULT_CONFIG, withBotConfig } from "../../ab-testing/botConfig";
import type { BotInput } from "../../input/createBotInput";
import { withNoteRequest } from "../../input/noteRequest";
import { buildUserMessageFromInput } from "./userMessage";

const post: Post = { id: "1", author_id: "a", created_at: "2026-09-29T22:07:10.000Z", text: "The slums are largely gone.", media: [] };
const input: BotInput = { mediaResult: { tweetMedia: [], quotedTweetMedia: [] }, mediaMadeWithAiLabel: false };

describe("user message", () => {
  test("a note request is the last section, after the post", () => {
    const message = withBotConfig(DEFAULT_CONFIG, () =>
      withNoteRequest({ handle: "priya_k_writes", text: "is this true? Dharavi still exists" }, () =>
        buildUserMessageFromInput(post, input)));
    const request = message.indexOf("## Request from the person who tagged the bot");
    expect(request).toBeGreaterThan(message.indexOf("The slums are largely gone."));
    expect(message.slice(request)).toContain('@priya_k_writes replied to this post and tagged the bot:\n"is this true? Dharavi still exists"');
    expect(message).toEndWith("even when it is not the post's main argument.");
  });

  test("a feed post has no request section", () => {
    const message = withBotConfig(DEFAULT_CONFIG, () => buildUserMessageFromInput(post, input));
    expect(message).not.toContain("## Request from");
  });
});
