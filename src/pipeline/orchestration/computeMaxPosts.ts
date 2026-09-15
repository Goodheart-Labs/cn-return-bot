import type { SubmissionCapacity } from "../capacity/submissionReserve";

export const MAX_POSTS_CAP = 20;

/** Estimates cannot close admission. A cooldown probe needs only one candidate. */
export function computeMaxPosts(capacity: SubmissionCapacity): { maxPosts: number; estimate: number } {
  const maxPosts = !capacity.canSubmit || capacity.signalQueued > 0
    ? 0
    : capacity.probe ? 1 : MAX_POSTS_CAP;
  return { maxPosts, estimate: maxPosts };
}
