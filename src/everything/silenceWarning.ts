/* Tells Slack when a notewriter goes silent and when it asks again, and
 * returns one problem for the feed run per silent notewriter. The rules are
 * in notewriterSilence.ts. */

import { postToSlack } from "../pipeline/utils/slack";
import { fetchWatchedNotewriters, setSilenceWarnedFor } from "./db";
import { isSilent, NEVER_SEEN, silenceNotice, type SilenceNotice, type WatchedNotewriter } from "./notewriterSilence";

/** The channel the Claude note writer reports to, the same one the devbox's
 *  slack-bridge forwards to the note writer's session. */
const NOTEWRITERS_SLACK_CHANNEL = "C0CATM96UR1";

const utcTime = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

function noticeText(w: WatchedNotewriter, notice: NonNullable<SilenceNotice>): string {
  if (notice.kind === "back") return `The notewriter ${w.name} (${w.id}) asks for posts again.`;
  const since = notice.lastSeenAt.getTime() === NEVER_SEEN.getTime() ? "ever" : `since ${utcTime(notice.lastSeenAt)}`;
  return `:warning: The notewriter ${w.name} (${w.id}) has not asked for a post ${since}. The posts it should take wait until it asks again. It is run by ${w.owner}`;
}

/** Posts the warnings and all-clears that are due, and returns one problem
 *  for the run per silent notewriter. A post Slack refuses throws, so the run
 *  goes red and the next run tries again. */
export async function watchNotewriterSilence(now = new Date()): Promise<string[]> {
  const problems: string[] = [];
  for (const w of await fetchWatchedNotewriters()) {
    const silent = isSilent(w, now);
    const lastSeenAt = w.last_seen_at ? new Date(w.last_seen_at) : null;
    if (silent) problems.push(`The notewriter ${w.id} has something to take but has not asked for a post since ${lastSeenAt ? utcTime(lastSeenAt) : "it was added"}.`);
    const notice = silenceNotice(silent, lastSeenAt, w.silence_warned_for ? new Date(w.silence_warned_for) : null);
    if (!notice) continue;
    await postToSlack(NOTEWRITERS_SLACK_CHANNEL, noticeText(w, notice));
    await setSilenceWarnedFor(w.id, notice.kind === "warn" ? notice.lastSeenAt : null);
    console.log(`Told Slack that the notewriter ${w.id} ${notice.kind === "warn" ? "is silent" : "is back"}`);
  }
  return problems;
}
