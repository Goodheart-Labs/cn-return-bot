/* Tells Slack when one of our own notewriters goes silent and when it calls
 * again. cn-walk runs it every 5 minutes. The rules are in
 * notewriterSilence.ts. */

import { postToSlack } from "../pipeline/utils/slack";
import { fetchWatchedNotewriters, setSilenceWarnedFor } from "./db";
import { isSilent, NEVER_SEEN, silenceNotice, type SilenceNotice, type WatchedNotewriter } from "./notewriterSilence";

/** The channel the Claude note writer reports to, the same one the devbox's
 *  slack-bridge forwards to the note writer's session. */
const NOTEWRITERS_SLACK_CHANNEL = "C0CATM96UR1";

const utcTime = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

function noticeText(w: WatchedNotewriter, notice: NonNullable<SilenceNotice>): string {
  if (notice.kind === "back") return `The notewriter ${w.name} (${w.id}) calls again.`;
  const since = notice.lastSeenAt.getTime() === NEVER_SEEN.getTime() ? "ever" : `since ${utcTime(notice.lastSeenAt)}`;
  return `:warning: The notewriter ${w.name} (${w.id}) has not called the notewriter API ${since}. The posts it would take wait for the others. It is run by ${w.owner}`;
}

/** Posts the warnings and all-clears that are due. A post Slack refuses
 *  throws, so cn-walk restarts and tries again. */
export async function watchNotewriterSilence(now = new Date()): Promise<void> {
  for (const w of await fetchWatchedNotewriters()) {
    const lastSeenAt = w.last_seen_at ? new Date(w.last_seen_at) : null;
    const notice = silenceNotice(isSilent(w, now), lastSeenAt, w.silence_warned_for ? new Date(w.silence_warned_for) : null);
    if (!notice) continue;
    await postToSlack(NOTEWRITERS_SLACK_CHANNEL, noticeText(w, notice));
    await setSilenceWarnedFor(w.id, notice.kind === "warn" ? notice.lastSeenAt : null);
    console.log(`[walk] told Slack that the notewriter ${w.id} ${notice.kind === "warn" ? "is silent" : "is back"}`);
  }
}
