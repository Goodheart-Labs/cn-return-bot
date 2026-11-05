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
 * when the notewriter asks again (GOO-695 did this for Claude alone). This
 * file holds the rules, and silenceWarning.ts reads the notewriters and posts
 * to Slack. */

import { PIPELINE_NOTEWRITER } from "../notewriters/ids";

/** What the silence watch needs about each notewriter. */
export interface WatchedNotewriter {
  id: string;
  name: string;
  owner: string;
  every_minutes: number | null;
  takes_reader_requests: boolean;
  last_seen_at: string | null;
  silence_warned_for: string | null;
  holdsPost: boolean;
}

export const SILENCE_LIMIT_MS = 30 * 60_000;

/** Stands in for the last ask of a notewriter that never asked, so its
 *  silence is still warned about only once. */
export const NEVER_SEEN = new Date(0);

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
