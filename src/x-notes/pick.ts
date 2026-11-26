/**
 * Which posts of a walk the X note writer checks (GOO-865). This module
 * touches no database, so its rules can be tested with made-up walks.
 *
 * A post can be checked when its predicted views still to come clear
 * VIEWS_TO_COME_FLOOR and X did not mark it, or a post it refers to, as
 * possibly sensitive. There is no age limit: the prediction shrinks with age
 * and is zero from 48 hours on. A post without a score, because the walk
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
import { featuresFromPost } from "../pipeline/ranking/features";
import type { Scorer } from "../pipeline/ranking/scorers";
import { velocityPerHour } from "../pipeline/utils/velocity";
import { VIEWS_TO_COME_FLOOR } from "../pipeline/utils/viewsToCome";
import type { CompetitionFeed } from "./competition";

/** The posts of the walk that may be checked, before skipping the ones we
 *  already handled. */
export function eligiblePosts(readings: Reading[], scores: Map<string, number | null>): SourcedPost[] {
  return readings.flatMap(({ post, observedAt, tier }) => {
    const viewsToCome = scores.get(post.id) ?? null;
    if (viewsToCome === null || viewsToCome < VIEWS_TO_COME_FLOOR) return [];
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

/** The posts of the walk the competition writer would take: in its feed, with
 *  a score at its threshold or above, by its own reading or by ours. While it
 *  has no threshold yet, every scored post of its feed counts as its. */
export function competitionPosts(readings: Reading[], scores: Map<string, number | null>, competition: CompetitionFeed): Set<string> {
  const threshold = competition.threshold ?? 0;
  const taken = new Set<string>();
  for (const { post } of readings) {
    if (!competition.scores.has(post.id)) continue;
    const best = Math.max(competition.scores.get(post.id) ?? 0, scores.get(post.id) ?? 0);
    if (best > 0 && best >= threshold) taken.add(post.id);
  }
  return taken;
}
