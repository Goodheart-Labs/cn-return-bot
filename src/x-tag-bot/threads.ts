/**
 * Reading a conversation tree. Every function here is pure: it gets the
 * stored posts of a post's threads and answers one question about them.
 */

import type { CurrentAnswer, ThreadPost } from "./prompts";
import type { BotKind, PostRow } from "./store";

/** The bot's replies under one of its waiting notes that settle it. */
const SETTLING_REPLIES: readonly BotKind[] = ["submitted", "other_version_submitted", "already_submitted", "gave_up", "refused"];

/** The chain of posts from the tag down to the given post, oldest first. */
export function pathTo(posts: PostRow[], tweetId: string): PostRow[] {
  const byId = new Map(posts.map((post) => [post.tweetId, post]));
  const path: PostRow[] = [];
  for (let post = byId.get(tweetId); post; post = post.parentTweetId ? byId.get(post.parentTweetId) : undefined) {
    path.unshift(post);
  }
  return path;
}

/** The answer a reply is about: the nearest note or no-note answer above it. */
export function currentAnswerAbove(path: PostRow[]): CurrentAnswer {
  for (const post of [...path].reverse()) {
    if (post.role !== "bot") continue;
    if (post.draft) return { kind: "note", ...post.draft };
    if (post.kind === "no_note") return { kind: "no_note", reply: post.text };
  }
  throw new Error("No answer from the bot above this post.");
}

export function asThreadPosts(path: PostRow[]): ThreadPost[] {
  return path.map((post) => ({ handle: post.authorHandle, text: post.text }));
}

/** The newest answer the bot gave on the post in any thread: a note or a
 *  no-note answer. A second tag on the same post gets it again. */
export function latestAnswer(posts: PostRow[]): PostRow | undefined {
  return posts.filter((post) => post.role === "bot" && (post.draft || post.kind === "no_note")).at(-1);
}

/** The waiting notes on the post that nothing has settled yet, newest first.
 *  Only the newest one is still tried. An older one is a version that a later
 *  revision replaced, and it gets its final reply together with the newest. A
 *  newer no-note answer, such as a withdrawal, settles every note before it. */
export function openWaitingNotes(posts: PostRow[]): PostRow[] {
  const settled = new Set(posts
    .filter((post) => post.role === "bot" && SETTLING_REPLIES.includes(post.kind as BotKind))
    .map((post) => post.parentTweetId));
  const lastNoNote = posts.filter((post) => post.kind === "no_note").at(-1)?.createdAt ?? "";
  return posts.filter((post) => post.kind === "waiting" && !settled.has(post.tweetId) && post.createdAt > lastNoNote)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The bot post whose note went in, when the bot submitted the post's note.
 *  Undefined when another of our bots submitted it. */
export function submittedVersion(posts: PostRow[]): PostRow | undefined {
  const submitted = posts.filter((post) => post.kind === "submitted").at(-1);
  if (!submitted) return undefined;
  return submitted.draft ? submitted : posts.find((post) => post.tweetId === submitted.parentTweetId);
}
