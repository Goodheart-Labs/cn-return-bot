/* Tells Slack when the Claude note writer is in trouble (GOO-819). Jim asked
 * for a message whenever something breaks (GOO-787).
 *
 * The runner reports three problems: its Claude login no longer works, it has
 * not read the plan's usage for 30 minutes, and several Claudes in a row
 * failed, for example because the account was banned or rate limited. Each
 * problem is posted once when it starts and once when it clears, so a long
 * outage does not flood the channel. The state lives in memory, so a restart
 * during an outage posts the problem once more. A runner that stopped
 * altogether is noticed by cn-walk's silence watch instead.
 *
 * The image screen also posts here when it stops a job. */

import { CLAUDE_NOTEWRITER } from "../notewriters/ids";
import { NOTEWRITERS_SLACK_CHANNEL, postToSlack } from "../pipeline/utils/slack";

type Problem = "login" | "usage" | "failing";

/** Claude jobs in a row that must fail before Slack hears of it. One failure
 *  is often the post's or the tweet's fault; three in a row rarely are. */
const FAILURES_IN_A_ROW_TO_ALERT = 3;

const openProblems = new Set<Problem>();
let failuresInARow = 0;

/** One message to the notewriters' channel, naming this notewriter. A
 *  message Slack cannot take goes to the log instead: an alert must never stop
 *  the runner, and hq's runner has no Slack token (it crashed every 30 minutes
 *  while its login was dead, 2026-11-21). */
export async function tellSlack(text: string): Promise<void> {
  try {
    await postToSlack(NOTEWRITERS_SLACK_CHANNEL, `${CLAUDE_NOTEWRITER}: ${text}`);
  } catch (err) {
    console.error(`Alert not sent to Slack (${(err as Error).message}): ${text}`);
  }
}

export async function problemStarted(problem: Problem, text: string): Promise<void> {
  if (openProblems.has(problem)) return;
  openProblems.add(problem);
  await tellSlack(`:warning: ${text}`);
}

export async function problemCleared(problem: Problem, text: string): Promise<void> {
  if (!openProblems.delete(problem)) return;
  await tellSlack(text);
}

/** Counts a Claude job that ended: `failure` says what went wrong, or is null
 *  when the Claude finished. */
export async function claudeEnded(failure: string | null): Promise<void> {
  if (failure === null) {
    failuresInARow = 0;
    return problemCleared("failing", "Claudes finish their jobs again.");
  }
  failuresInARow++;
  if (failuresInARow >= FAILURES_IN_A_ROW_TO_ALERT) {
    await problemStarted("failing", `${failuresInARow} Claude jobs in a row failed. The last one said: ${failure}`);
  }
}
