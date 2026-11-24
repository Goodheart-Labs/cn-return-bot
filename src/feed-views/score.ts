/**
 * Each reading's score (GOO-865): the views the post is predicted to get from
 * now until it is 48 hours old (src/pipeline/utils/viewsToCome.ts). The speed
 * comes from the post's reading in the walk before, 10 minutes earlier.
 *
 * This module touches no database, so it can be tested with made-up walks.
 */

import { tweetAgeHours } from "../pipeline/orchestration/submitCandidates";
import { predictViewsToCome, type ViewReading } from "../pipeline/utils/viewsToCome";
import type { WalkResult } from "./walk";

/** Each reading of the walk as the earlier reading for the next walk. */
export function readingsOf(walk: WalkResult): Map<string, ViewReading> {
  const out = new Map<string, ViewReading>();
  for (const { post, observedAt } of walk.readings) {
    const impressions = post.public_metrics?.impression_count;
    if (impressions != null) out.set(post.id, { impressions, observedAtMs: observedAt.getTime() });
  }
  return out;
}

/** Each post's predicted views still to come, or null when the walk before
 *  did not read it or a count is missing. */
export function scoreWalk(walk: WalkResult, before: Map<string, ViewReading>): Map<string, number | null> {
  const now = readingsOf(walk);
  const scores = new Map<string, number | null>();
  for (const { post, observedAt } of walk.readings) {
    const reading = now.get(post.id);
    const ageHours = tweetAgeHours(post, observedAt.getTime());
    scores.set(post.id, reading && ageHours !== null
      ? predictViewsToCome(observedAt.getTime() - ageHours * 3_600_000, before.get(post.id), reading)
      : null);
  }
  return scores;
}
