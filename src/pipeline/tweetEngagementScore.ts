/**
 * Tweet Engagement Score
 *
 * Scores tweets by virality/engagement so we prioritize writing notes
 * on tweets that will generate the most views. Used for tweet selection
 * in generateCandidates (which tweets to process) and candidate ranking
 * (which notes to submit first).
 *
 * The score is log-scaled since impressions span orders of magnitude
 * (10K to 100M+). A tweet with 10M impressions should rank higher than
 * one with 100K, but not 100x higher — diminishing returns.
 */

import type { TweetPublicMetrics } from "../api/fetchEligiblePosts";

/**
 * Compute a log-scaled engagement score from tweet public metrics.
 *
 * Components:
 * - log10(impressions) as the base (dominant signal)
 * - Engagement rate bonus: (likes + retweets + quotes) / impressions
 *   scaled by 2, capped at 1.0. High engagement rate means the tweet
 *   is actively spreading and will accumulate more impressions.
 *
 * Returns 0 for tweets with no metrics (they'll sort last).
 */
export function tweetEngagementScore(
  metrics: TweetPublicMetrics | undefined,
  authorFollowers?: number
): number {
  if (!metrics) return 0;

  const impressions = metrics.impression_count ?? 0;
  if (impressions <= 0) return 0;

  // Base: log10 of impressions (e.g., 100K = 5.0, 1M = 6.0, 10M = 7.0)
  const logImpressions = Math.log10(impressions);

  // Engagement rate bonus: active engagement suggests the tweet is still growing
  const engagements =
    (metrics.like_count ?? 0) +
    (metrics.retweet_count ?? 0) +
    (metrics.quote_count ?? 0);
  const engagementRate = engagements / impressions;
  const engagementBonus = Math.min(engagementRate * 2, 1.0);

  return logImpressions + engagementBonus;
}

/**
 * Sort posts by engagement score (highest first), with recency as tiebreaker.
 * Posts are sorted in-place and also returned.
 */
export function sortByEngagement<
  T extends {
    id: string;
    public_metrics?: TweetPublicMetrics;
    author_followers?: number;
  }
>(posts: T[]): T[] {
  return posts.sort((a, b) => {
    const scoreA = tweetEngagementScore(a.public_metrics, a.author_followers);
    const scoreB = tweetEngagementScore(b.public_metrics, b.author_followers);
    if (scoreB !== scoreA) return scoreB - scoreA;
    // Tiebreak: newest first (higher ID = newer)
    return BigInt(b.id) > BigInt(a.id) ? 1 : -1;
  });
}
