/**
 * Which posts of a walk the X note writer checks (GOO-865). This module
 * touches no database, so its rules can be tested with made-up walks.
 *
 * A post can be checked when it is at most 24 hours old (the stale cutoff,
 * because a note on an older post is never submitted), its predicted views
 * still to come clear VIEWS_TO_COME_FLOOR, and X did not mark it, or a post it
 * refers to, as possibly sensitive. A post without a score, because the walk
 * before did not read it, waits for the next walk.
 *
 * Of those, the writer takes as many as its budget allows, in the order of
 * the ladder: every small post before any large one and every large one before
 * any XL one, each tier by predicted views still to come. With a ranking
 * scorer from the A/B test, the scorer orders them across tiers instead. Jim
 * wants to move to the score alone later.
 */

import { isPossiblySensitive } from "../api/fetchEligiblePosts";
import type { Reading } from "../feed-views/walk";
import { RECORDED_TIERS } from "../feed-views/walk";
import type { SourcedPost } from "../pipeline/orchestration/generateCandidates";
import { STALE_TWEET_CUTOFF_HOURS, tweetAgeHours } from "../pipeline/orchestration/submitCandidates";
import { featuresFromPost } from "../pipeline/ranking/features";
import type { Scorer } from "../pipeline/ranking/scorers";
import { velocityPerHour } from "../pipeline/utils/velocity";
import { VIEWS_TO_COME_FLOOR } from "../pipeline/utils/viewsToCome";

/** The posts of the walk that may be checked, before skipping the ones we
 *  already handled. */
export function eligiblePosts(readings: Reading[], scores: Map<string, number | null>): SourcedPost[] {
  return readings.flatMap(({ post, observedAt, tier }) => {
    const viewsToCome = scores.get(post.id) ?? null;
    const age = tweetAgeHours(post, observedAt.getTime());
    if (viewsToCome === null || viewsToCome < VIEWS_TO_COME_FLOOR) return [];
    if (age !== null && age > STALE_TWEET_CUTOFF_HOURS) return [];
    if (isPossiblySensitive(post)) return [];
    return [{ post, feedSize: tier, velocity: velocityPerHour(post, observedAt.getTime()), viewsToCome }];
  });
}

/** The posts to check now, best first, at most `budget` of them. */
export function pickPosts(eligible: SourcedPost[], skip: ReadonlySet<string>, budget: number, scorer: Scorer | null, asOfMs: number): SourcedPost[] {
  if (budget <= 0) return [];
  const tierRank = (s: SourcedPost) => RECORDED_TIERS.indexOf(s.feedSize as (typeof RECORDED_TIERS)[number]);
  const ladder = (a: SourcedPost, b: SourcedPost) => tierRank(a) - tierRank(b) || b.viewsToCome! - a.viewsToCome!;
  const score = (s: SourcedPost) => scorer!.scoreAdmission(featuresFromPost(s.post, s.velocity, s.viewsToCome, tierRank(s), asOfMs));
  const byScorer = (a: SourcedPost, b: SourcedPost) => score(b) - score(a);
  return eligible.filter((s) => !skip.has(s.post.id)).sort(scorer ? byScorer : ladder).slice(0, budget);
}
