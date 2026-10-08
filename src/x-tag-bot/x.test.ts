import { expect, test } from "bun:test";
import { incomingPostOf } from "./x";

// Trimmed from the post.reply.create sample in X's Activity API docs.
const replyEvent = {
  data: {
    event_type: "post.reply.create",
    tag: "replies",
    payload: {
      id: "2090000000000000001",
      text: "@ExampleUser approve",
      author_id: "2222222222222222222",
      in_reply_to_user_id: "1111111111111111111",
      referenced_tweets: [{ type: "replied_to", id: "2080761390344937796" }],
    },
    includes: { users: [{ id: "2222222222222222222", username: "OtherUser" }] },
  },
};

test("a reply event becomes an incoming post with its author's handle and parent", () => {
  expect(incomingPostOf(replyEvent)).toEqual({
    event: "reply", id: "2090000000000000001", text: "@ExampleUser approve", authorId: "2222222222222222222",
    authorHandle: "OtherUser", repliedToId: "2080761390344937796", quotedId: undefined,
  });
});

test("a mention that quotes a post names the quoted post", () => {
  const event = { data: { ...replyEvent.data, event_type: "post.mention.create",
    payload: { ...replyEvent.data.payload, referenced_tweets: [{ type: "quoted", id: "42" }] } } };
  expect(incomingPostOf(event)).toMatchObject({ event: "mention", quotedId: "42", repliedToId: undefined });
});

test("other events are ignored", () => {
  expect(incomingPostOf({ data: { event_type: "like.create", payload: {} } })).toBeNull();
});
