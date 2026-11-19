/* Watches that our own notewriters keep calling (GOO-724, GOO-791). One of
 * them is silent when it has not called for 30 minutes: v1's next_post or
 * subscribe, or any v2 call. A runner calls even while it rests, the v1
 * runners subscribe every 5 minutes and the v2 dispatcher calls
 * notewriter_api_me on every poll, so silence means the runner itself
 * stopped. The pipeline is never silent, because it has no program of its
 * own: the feed run calls for it. Outside notewriters are not watched.
 *
 * The Claude notes Slack channel hears of a silence once, and again when the
 * notewriter calls again (GOO-695 did this for Claude alone). cn-walk checks
 * every 5 minutes. This file holds the rules, and silenceWarning.ts reads the
 * notewriters and posts to Slack. */

import { PIPELINE_NOTEWRITER } from "../notewriters/ids";

/** What the silence watch needs about each notewriter. */
export interface WatchedNotewriter {
  id: string;
  name: string;
  owner: string;
  last_seen_at: string | null;
  silence_warned_for: string | null;
}

export const SILENCE_LIMIT_MS = 30 * 60_000;

/** Stands in for the last call of a notewriter that never called, so its
 *  silence is still warned about only once. */
export const NEVER_SEEN = new Date(0);

export function isSilent(w: WatchedNotewriter, now: Date): boolean {
  if (w.id === PIPELINE_NOTEWRITER) return false;
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
