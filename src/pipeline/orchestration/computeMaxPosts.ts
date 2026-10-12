import type { SubmissionCapacity } from "../capacity/submissionReserve";

export const MAX_POSTS_CAP = 20;

/** Estimates cannot close admission. A cooldown probe is sized like any other
 *  run: it needs one note to post, and about 1 processed post in 18 ends as one. */
export function computeMaxPosts(capacity: SubmissionCapacity): { maxPosts: number; estimate: number } {
  const maxPosts = !capacity.canSubmit || capacity.signalQueued > 0 ? 0 : MAX_POSTS_CAP;
  return { maxPosts, estimate: maxPosts };
}
