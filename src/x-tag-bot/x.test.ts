import { expect, test } from "bun:test";
import { tagOf } from "./x";

// Shaped like the post event samples in X's Activity API docs.
const mentionEvent = {
  data: {
    event_type: "post.mention.create",
    tag: "x-tag-bot",
    payload: {
      id: "2090000000000000001",
      text: "@community_notes is this true?",
      author_id: "2222222222222222222",
      in_reply_to_user_id: "1111111111111111111",
      referenced_tweets: [{ type: "replied_to", id: "2080761390344937796" }],
    },
    includes: { users: [{ id: "2222222222222222222", username: "OtherUser" }] },
  },
};

test("a mention becomes a tag with its author's handle and the post it replies to", () => {
  expect(tagOf(mentionEvent)).toEqual({
    id: "2090000000000000001", text: "@community_notes is this true?", authorId: "2222222222222222222",
    authorHandle: "OtherUser", repliedToId: "2080761390344937796", repliedToUserId: "1111111111111111111", quotedId: undefined,
  });
});

test("a mention that quotes a post names the quoted post", () => {
  const event = { data: { ...mentionEvent.data,
    payload: { ...mentionEvent.data.payload, in_reply_to_user_id: undefined, referenced_tweets: [{ type: "quoted", id: "42" }] } } };
  expect(tagOf(event)).toMatchObject({ quotedId: "42", repliedToId: undefined });
});

test("other events are ignored", () => {
  expect(tagOf({ data: { event_type: "post.reply.create", payload: {} } })).toBeNull();
});
