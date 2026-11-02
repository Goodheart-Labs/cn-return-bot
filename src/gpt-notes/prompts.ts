/* The GPT harness's prompts. The task comes word for word from the Claude
 * note writer's prompts (src/claude-notes/prompts.ts). Only the part on how to
 * work differs, because GPT saves notes and starts subagents with function
 * tools instead of Claude Code's shell and Agent tool. Its subagents are the
 * Agents SDK's own, which start from a fresh conversation, so the prompt asks
 * GPT to give each one everything it found. */

import { postTask, tweetInputSection, tweetTask } from "../claude-notes/prompts";
import { postMarkdown, type AskedPassages } from "../claude-notes/take";
import type { readItem } from "../claude-notes/store";
import { X_NOTE_MAX_CHARS } from "../claude-notes/xTweets";

const MODEL_NAME = "GPT";

export type PostItem = Awaited<ReturnType<typeof readItem>>;

/** What the harness checks: one Common Notes post, or one X tweet with the
 *  input the X run built for it. The picks are the A/B picks that decide
 *  parts of the prompt. */
export type Job =
  | { kind: "post"; item: PostItem; asked: AskedPassages; picks: Record<string, string> }
  | { kind: "tweet"; runId: string; input: string; picks: Record<string, string> };

export function postMessage(job: Extract<Job, { kind: "post" }>): string {
  return `${postTask(MODEL_NAME, job.picks, job.asked)}

## How to work here

The post is at the end of this message.

To save a note, call save_draft. A draft with outcome "note" goes up on commonnotes.net at once as an AI note. So call it exactly once per draft. Also save a draft for each passage you researched and decided against, with outcome no_note_needed or too_hard.

Readers see each source's quote under the note, so the quote must appear word for word on the page. Web search can open a page and find text in it. So open each source and check with find in page that the quote is on it.

For subagents, use the subagent tool. A subagent starts fresh. It sees the examples in your system prompt, but not this message, the post or the pages you read. So put everything it needs into its task: the passage, what to check, and everything you found that might help it, with the facts, quotes and links. It answers with what it found, and you save the drafts.

If the post has nothing worth checking, call skip_post with the reason.

## The post

${postMarkdown(job.item)}`;
}

export function tweetMessage(job: Extract<Job, { kind: "tweet" }>): string {
  return `${tweetTask(MODEL_NAME, job.picks)}

If the post has images, they are attached to this message after the post.

If the post needs a note, call submit_x_note with the note, with the links to its sources, and a few sentences on why the post needs it. A note has at most ${X_NOTE_MAX_CHARS} characters, where each link counts as one, and needs at least one link. If the post needs no note, call x_no_note with the reason.

If you use subagents, use the subagent tool. A subagent starts fresh. It sees the examples in your system prompt, but not this message, the tweet or the pages you read. So put everything it needs into its task: what to check, and everything you found that might help it, with the facts, quotes and links. It answers with what it found, and you submit the answer.

${tweetInputSection(job.input)}`;
}

/** A subagent's message: the task its parent wrote, with a short frame. */
export const subagentBrief = (task: string) =>
  `Another agent that writes notes gave you this task. The examples in your system prompt show what good and bad notes look like. Do the research the task asks for, and answer with what you found: the facts, the quotes copied word for word from the pages, and their links.

${task}`;
