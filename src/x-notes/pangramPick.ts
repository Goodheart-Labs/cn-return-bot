/**
 * The rules of the first account's Pangram pass that need no database
 * (GOO-880), so they can be tested with made-up walks. The pass itself is in
 * pangram.ts.
 */

import { isPossiblySensitive, type Post } from "../api/fetchEligiblePosts";
import type { FeedSize } from "../pipeline/orchestration/utils/feedSizeStrategy";
import { isLongForm } from "../pipeline/pangram-monitoring/longFormFilter";
import { SCORE_HISTORY_DAYS, type ScoreHistory } from "../pipeline/utils/viewsThreshold";

const HISTORY_MS = SCORE_HISTORY_DAYS * 24 * 3_600_000;

export type PangramCandidate = { post: Post; tier: FeedSize; viewsToCome: number };

/** A long-form post's first sighting with a positive score, and its best score. */
export type BestScore = { firstSeenAt: number; best: number };

/** The posts of a walk the pass could send to Pangram: long-form, not marked
 *  as possibly sensitive, and with a positive score. Each post comes with the
 *  smallest tier it was in, "xxl" for the posts only in XXL. */
export function longFormScored(readings: { post: Post; tier: FeedSize }[], scores: Map<string, number | null>): PangramCandidate[] {
  return readings.flatMap(({ post, tier }) => {
    const viewsToCome = scores.get(post.id) ?? null;
    if (viewsToCome === null || viewsToCome <= 0 || !isLongForm(post) || isPossiblySensitive(post)) return [];
    return [{ post, tier, viewsToCome }];
  });
}

/** Adds the walk's scores to the history and returns the rows that changed:
 *  posts seen for the first time, and posts whose score beat their best. */
export function addScores(history: Map<string, BestScore>, scored: PangramCandidate[], nowMs: number): [string, BestScore][] {
  const changed: [string, BestScore][] = [];
  for (const { post, viewsToCome } of scored) {
    const before = history.get(post.id);
    if (before && before.best >= viewsToCome) continue;
    const next = { firstSeenAt: before?.firstSeenAt ?? nowMs, best: viewsToCome };
    history.set(post.id, next);
    changed.push([post.id, next]);
  }
  return changed;
}

/** The long-form posts that arrived in the last 7 days with their best scores.
 *  It also drops the older ones from the history. */
export function scoreHistory(history: Map<string, BestScore>, nowMs: number): ScoreHistory {
  let earliest = nowMs;
  const bestScores: number[] = [];
  for (const [tweetId, { firstSeenAt, best }] of history) {
    if (firstSeenAt < nowMs - HISTORY_MS) {
      history.delete(tweetId);
      continue;
    }
    earliest = Math.min(earliest, firstSeenAt);
    bestScores.push(best);
  }
  return { hours: (nowMs - earliest) / 3_600_000, bestScores: bestScores.sort((a, b) => b - a) };
}

/** The posts to send to Pangram now, best first: at the threshold or above,
 *  not checked before, and at most `limit`. */
export function pickForPangram(scored: PangramCandidate[], skip: ReadonlySet<string>, threshold: number, limit: number): PangramCandidate[] {
  return scored
    .filter((s) => s.viewsToCome >= threshold && !skip.has(s.post.id))
    .sort((a, b) => b.viewsToCome - a.viewsToCome)
    .slice(0, limit);
}
