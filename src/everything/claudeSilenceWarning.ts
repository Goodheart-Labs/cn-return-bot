/* Tells the Claude notes Slack channel when the Claude note writer goes silent
 * and when it is back (GOO-695). The note writer reports the usage of its
 * Claude plan every 5 minutes, and a newest reading older than 30 minutes means
 * it takes no work (usagePacing.ts). The feed run then goes red, but a red run
 * is only seen in the next morning's CI report, and the queued posts, reader
 * requests and X tweets wait until then.
 *
 * One warning goes out per outage. The feed run stores the time of the newest
 * reading when it warns, and later runs that see the same newest reading stay
 * quiet. The first run that finds the note writer reporting again says so and
 * clears the stored time. */

import { postToSlack } from "../pipeline/utils/slack";
import { readClaudeSilenceWarnedFor, setClaudeSilenceWarnedFor } from "./db";
import type { ClaudePacing } from "./usagePacing";

/** The channel the Claude note writer reports to, the same one the devbox's
 *  slack-bridge forwards to the note writer's session. */
const CLAUDE_NOTES_SLACK_CHANNEL = "C0CATM96UR1";

/** Stands in for the newest reading when there is none at all, so a silence
 *  without any reading is still warned about only once. */
const NO_READING = new Date(0);

export type SilenceNotice = { kind: "warn"; newestReadingAt: Date } | { kind: "back" } | null;

/** What to post, given this run's pacing and the outage already warned about. */
export function silenceNotice(pacing: ClaudePacing, warnedFor: Date | null): SilenceNotice {
  if (pacing.kind === "runner_silent") {
    const newestReadingAt = pacing.lastReadingAt ?? NO_READING;
    return warnedFor?.getTime() === newestReadingAt.getTime() ? null : { kind: "warn", newestReadingAt };
  }
  return warnedFor ? { kind: "back" } : null;
}

const utcTime = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

function noticeText(notice: NonNullable<SilenceNotice>): string {
  if (notice.kind === "back") return "The Claude note writer reports again and takes the queued work again.";
  const since = notice.newestReadingAt === NO_READING ? "in the last 7 days" : `since ${utcTime(notice.newestReadingAt)}`;
  return [
    `:warning: The Claude note writer has not reported the usage of its Claude plan ${since}.`,
    "Nothing takes the queued posts, reader requests or X tweets until it reports again.",
    "On the devbox, look at the tmux session cn-return-bot--sandbox-nathan-claude-code-notes. On Nathan's ai-box, look at the cn-notes-runner service.",
  ].join(" ");
}

/** Posts the warning or the all-clear when one is due. A post Slack refuses
 *  throws, so the run goes red and the next run tries again. */
export async function announceClaudeSilence(pacing: ClaudePacing): Promise<void> {
  const notice = silenceNotice(pacing, await readClaudeSilenceWarnedFor());
  if (!notice) return;
  await postToSlack(CLAUDE_NOTES_SLACK_CHANNEL, noticeText(notice));
  await setClaudeSilenceWarnedFor(notice.kind === "warn" ? notice.newestReadingAt : null);
  console.log(`Told Slack that the Claude note writer ${notice.kind === "warn" ? "is silent" : "is back"}`);
}
