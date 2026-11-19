/* A reviewer's message on the review page (GOO-563). One Claude answers it
 * with `claude-notes answer`, and may propose a better text, which the
 * reviewer posts if they agree. */

import { messagePrompt, EXAMPLES_PATH } from "../prompts";
import { logEvent, postDir, readDraft, readItem, unansweredMessages } from "../store";
import { CLAUDE_RUN_TAGS } from "../usageShare";
import { type JobKind, mayRetry } from "./kind";

type ReviewerMessage = { draftId: string; text: string; from: string };

/** Answers at once. Messages are rare, a few a week. */
const MAX_ANSWERS_RUNNING = 3;
/** An answer has no deadline of its own. A Claude still at one after this long
 *  is stuck. */
const ANSWER_MAX_MS = 60 * 60_000;

/** The newest unanswered message of each draft. */
async function waitingMessages(): Promise<Map<string, ReviewerMessage>> {
  const waiting = new Map<string, ReviewerMessage>();
  for (const m of await unansweredMessages()) waiting.set(m.draft_id!, { draftId: m.draft_id!, text: (m.data as { text: string }).text, from: m.actor });
  return waiting;
}

/** The draft and post a reviewer's message is about, for its prompt. */
async function messageContext(draftId: string) {
  const { passage, note, sources, reasoning, outcome, status, item_id } = await readDraft(draftId);
  const item = await readItem(item_id);
  return { draft: { id: draftId, passage, note, sources, reasoning, outcome, status }, url: item.url, dir: postDir(item.url) };
}

export const reviewAnswerJob: JobKind<ReviewerMessage> = {
  name: "review-answer",
  sessionPrefix: "cn-msg-",
  maxRunning: MAX_ANSWERS_RUNNING,
  tags: [CLAUDE_RUN_TAGS.commonNotes, CLAUDE_RUN_TAGS.reviewAnswer],
  key: (message) => message.draftId,
  waiting: async () => [...(await waitingMessages()).values()],

  async prepare(message, runDir) {
    return {
      prompt: messagePrompt({ text: message.text, from: message.from, ...(await messageContext(message.draftId)), runDir }),
      command: { model: "opus", effort: "high", appendSystemPromptFile: EXAMPLES_PATH },
    };
  },

  stopAt: (_message, startedAt) => startedAt + ANSWER_MAX_MS,
  ref: (message) => ({ draft_id: message.draftId }),

  /** A message Claude did not answer gets one more try. After that it waits
   *  for a person. */
  async close(message, run) {
    if (!(await waitingMessages()).has(message.draftId)) return "closed";
    if (mayRetry(run)) return "retry";
    await logEvent({ actor: "claude", type: "answer_failed", draftId: message.draftId, data: { runDir: run.runDir } });
    return "gave_up";
  },
};
