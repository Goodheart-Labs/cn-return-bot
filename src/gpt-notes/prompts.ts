/* The GPT harness's prompts. The task comes word for word from the Claude
 * note writer's prompts (src/claude-notes/prompts.ts). Only the part on how to
 * work differs, because GPT saves notes and starts subagents with function
 * tools instead of Claude Code's shell and Agent tool. */

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

For subagents, use the fork tool. A fork starts with your whole context, so it knows this prompt and the examples in your system prompt. A fork may save its notes itself with save_draft, or put what it found in its answer to you. Both are fine. Only you call write_report.

When you are done, call write_report with every passage you checked and its outcome. If the post has nothing worth checking, call write_report with skipped set to true and the reason instead.

## The post

${postMarkdown(job.item)}`;
}

export function tweetMessage(job: Extract<Job, { kind: "tweet" }>): string {
  return `${tweetTask(MODEL_NAME, job.picks)}

If the post has images, they are attached to this message after the post.

If the post needs a note, call submit_x_note with the note, with the links to its sources, and a few sentences on why the post needs it. A note has at most ${X_NOTE_MAX_CHARS} characters, where each link counts as one, and needs at least one link. If the post needs no note, call x_no_note with the reason. Stop once one of the two has succeeded.

If you use subagents, use the fork tool. A fork starts with your whole context, so it knows this prompt and the examples in your system prompt. A fork may submit the note itself, or put what it found in its answer to you. Both are fine.

${tweetInputSection(job.input)}`;
}

/** The answer a fork sees to its own fork call: its task. */
export const forkBrief = (task: string) =>
  `You are this fork. Your task: ${task}

Do only this task, and start no forks of your own. When you are done, answer with what you found. Your answer goes back to the agent that started you.`;

/** The answer a fork sees to the other calls of the same turn, which the
 *  agent that started it handles. */
export const OTHER_CALL_IN_FORK = "This call belongs to the agent that started this fork. Its result is not shown here.";
