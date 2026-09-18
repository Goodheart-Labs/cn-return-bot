import type { SubmissionCapacity } from "../capacity/submissionReserve";

export const MAX_POSTS_CAP = 20;

export interface MaxPosts {
  maxPosts: number;
  estimate: number;
  /** Set on a cooldown probe: stop starting posts once this many notes are ready. */
  stopAfterCandidates?: number;
}

/** Estimates cannot close admission. A cooldown probe needs one note to post,
 *  and only about 1 processed post in 18 ends as one, so the probe walks the
 *  ranked batch until a note is ready instead of processing a single post. */
export function computeMaxPosts(capacity: SubmissionCapacity): MaxPosts {
  if (!capacity.canSubmit || capacity.signalQueued > 0) return { maxPosts: 0, estimate: 0 };
  if (capacity.probe) return { maxPosts: MAX_POSTS_CAP, estimate: 1, stopAfterCandidates: 1 };
  return { maxPosts: MAX_POSTS_CAP, estimate: MAX_POSTS_CAP };
}
