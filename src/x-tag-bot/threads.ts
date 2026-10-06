/**
 * Reading a conversation tree. Every function here is pure: it gets the
 * stored posts of a post's threads and answers one question about them.
 */

import type { CurrentAnswer, ThreadPost } from "./prompts";
import type { BotKind, PostRow } from "./store";

/** A reply the bot gives to an approval once it is decided. A "queued" reply
 *  is not one, because the approval still waits. An "answer" to an
 *  improve-and-approve is one: the bot kept the draft, so nothing waits. */
const FINAL_REPLIES: readonly BotKind[] = [
  "submitted", "other_draft_submitted", "already_submitted", "not_on_path", "gave_up", "refused", "answer",
];

const isApproval = (post: PostRow) => post.kind === "approve" || post.kind === "improve_and_approve";

/** The chain of posts from the tag down to the given post, oldest first. */
export function pathTo(posts: PostRow[], tweetId: string): PostRow[] {
  const byId = new Map(posts.map((post) => [post.tweetId, post]));
  const path: PostRow[] = [];
  for (let post = byId.get(tweetId); post; post = post.parentTweetId ? byId.get(post.parentTweetId) : undefined) {
    path.unshift(post);
  }
  return path;
}

/** Who may approve a draft: everyone who wrote a post on the path from the
 *  tag down to it. That is the person who asked, and everyone whose
 *  suggestion led to this draft. */
export function approversOf(posts: PostRow[], draftTweetId: string): Set<string> {
  return new Set(pathTo(posts, draftTweetId).filter((post) => post.role === "human").map((post) => post.authorId));
}

/** The answer a reply is about: the nearest draft or no-note answer above it. */
export function currentAnswerAbove(path: PostRow[]): CurrentAnswer {
  for (const post of [...path].reverse()) {
    if (post.role !== "bot") continue;
    if (post.draft) return { kind: "draft", ...post.draft };
    if (post.kind === "no_note") return { kind: "no_note", reply: post.text };
  }
  throw new Error("No answer from the bot above this post.");
}

export function asThreadPosts(path: PostRow[]): ThreadPost[] {
  return path.map((post) => ({ handle: post.authorHandle, text: post.text }));
}

/** The bot post that holds the version an approval approves. A plain approval
 *  approves the draft it replies to. An improve-and-approve approves the
 *  improved version the bot posted under it. */
export function approvedVersion(posts: PostRow[], approval: PostRow): PostRow | undefined {
  if (approval.kind === "improve_and_approve") {
    return posts.find((post) => post.parentTweetId === approval.tweetId && post.role === "bot" && post.draft);
  }
  return posts.find((post) => post.tweetId === approval.parentTweetId && post.draft);
}

/** Approvals that have no final reply yet, split into the ones still inside
 *  the waiting window and the ones past it. Newest first. */
export function openApprovals(posts: PostRow[], now: Date, maxWaitMs: number): { waiting: PostRow[]; expired: PostRow[] } {
  const decided = new Set(posts
    .filter((post) => post.role === "bot" && FINAL_REPLIES.includes(post.kind as BotKind))
    .map((post) => post.parentTweetId));
  const open = posts.filter((post) => isApproval(post) && !decided.has(post.tweetId) && approvedVersion(posts, post))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const expired = (post: PostRow) => now.getTime() - new Date(post.createdAt).getTime() > maxWaitMs;
  return { waiting: open.filter((post) => !expired(post)), expired: open.filter(expired) };
}

/** The bot post whose version went in, when the bot submitted the post's
 *  note. Undefined when another of our bots submitted it. */
export function submittedVersion(posts: PostRow[]): PostRow | undefined {
  const submitted = posts.filter((post) => post.kind === "submitted").at(-1);
  if (!submitted) return undefined;
  if (submitted.draft) return submitted;
  const approval = posts.find((post) => post.tweetId === submitted.parentTweetId);
  return approval && approvedVersion(posts, approval);
}

/** The newest answer the bot gave on the post in any thread: a draft or a
 *  no-note answer. A second tag on the same post gets it again. */
export function latestAnswer(posts: PostRow[]): PostRow | undefined {
  return posts.filter((post) => post.role === "bot" && (post.draft || post.kind === "no_note")).at(-1);
}
