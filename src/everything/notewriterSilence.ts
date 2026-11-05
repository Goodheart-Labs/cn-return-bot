/* Watches that every notewriter keeps asking for posts (GOO-724). A
 * notewriter is silent when it has something to take, because it is
 * subscribed or takes reader requests, holds no post, and has not asked for
 * one in 30 minutes. A notewriter that holds a post is busy, and its deadline
 * catches a crash. The pipeline is never silent, because the feed run that
 * watches is the pipeline's own worker.
 *
 * A silent notewriter turns every feed run red. A red run is seen only in the
 * next morning's CI report, while the posts it should take wait. So the
 * Claude notes Slack channel hears of it at once, once per silence, and again
 * when the notewriter asks again (GOO-695 did this for Claude alone). */

import { postToSlack } from "../pipeline/utils/slack";
import { PIPELINE_NOTEWRITER } from "../notewriters/ids";
import { fetchWatchedNotewriters, setSilenceWarnedFor, type WatchedNotewriter } from "./db";

export const SILENCE_LIMIT_MS = 30 * 60_000;

/** Stands in for the last ask of a notewriter that never asked, so its
 *  silence is still warned about only once. */
export const NEVER_SEEN = new Date(0);

/** The channel the Claude note writer reports to, the same one the devbox's
 *  slack-bridge forwards to the note writer's session. */
const NOTEWRITERS_SLACK_CHANNEL = "C0CATM96UR1";

export function isSilent(w: WatchedNotewriter, now: Date): boolean {
  if (w.id === PIPELINE_NOTEWRITER || w.holdsPost) return false;
  if (w.every_minutes === null && !w.takes_reader_requests) return false;
  return !w.last_seen_at || now.getTime() - new Date(w.last_seen_at).getTime() > SILENCE_LIMIT_MS;
}

export type SilenceNotice = { kind: "warn"; lastSeenAt: Date } | { kind: "back" } | null;

/** What to post, given whether the notewriter is silent now and the silence
 *  already warned about. */
export function silenceNotice(silent: boolean, lastSeenAt: Date | null, warnedFor: Date | null): SilenceNotice {
  if (silent) {
    const since = lastSeenAt ?? NEVER_SEEN;
    return warnedFor?.getTime() === since.getTime() ? null : { kind: "warn", lastSeenAt: since };
  }
  return warnedFor ? { kind: "back" } : null;
}

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
