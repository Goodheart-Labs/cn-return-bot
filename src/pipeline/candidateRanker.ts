/**
 * Candidate Ranker
 *
 * Ranks candidates by X API evaluation score, tweet impressions, and freshness decay.
 * When capped, submits the highest-scoring candidates on the most viral tweets first.
 *
 * Signals:
 * - Eval score (sigmoidified): X API's ML prediction of helpfulness
 * - Tweet impressions (log-scaled): Higher-impression tweets = more views if note is Helpful
 * - Freshness decay: Penalizes old candidates so we don't sit on stale notes
 */

// Freshness: score penalty per hour of age
const FRESHNESS_DECAY_PER_HOUR = 0.02;

// Weight for log10(impressions), normalized to ~0-1 range.
// log10(100K)=5, log10(10M)=7, so dividing by 8 gives ~0.6 to ~0.9.
// This makes a 10M-impression tweet worth ~0.25 more than a 100K tweet.
const IMPRESSIONS_WEIGHT = 1 / 8;

export interface CandidateForRanking {
  pipelineRunId: string;
  tweetId: string;
  noteText: string;
  sourceUrl: string;
  botId: string;
  createdAt: Date;
  searchResults: string;
  tweetText: string;
  tweetImpressions?: number;
  scores: {
    evaluation?: number;
  };
}

export interface RankedCandidate extends CandidateForRanking {
  rankScore: number;
}

/**
 * Sigmoid function to normalize unbounded eval scores to 0-1 range.
 * eval scores are typically in [-3, 3] range.
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Rank all candidates by eval score + tweet impressions + freshness decay.
 * Candidates without eval scores go last (sorted by freshness among themselves).
 */
export function rankCandidates(candidates: CandidateForRanking[]): RankedCandidate[] {
  if (candidates.length === 0) return [];

  const now = Date.now();

  const scored: RankedCandidate[] = candidates.map((c) => {
    const ageHours = (now - c.createdAt.getTime()) / (1000 * 60 * 60);
    const evalScore = c.scores.evaluation !== undefined
      ? sigmoid(c.scores.evaluation)
      : sigmoid(-1); // ~0.27, "unknown, assume below average"

    // Log-scaled impressions bonus: 100K=0.63, 1M=0.75, 10M=0.88
    const impressionsBonus = c.tweetImpressions && c.tweetImpressions > 0
      ? Math.log10(c.tweetImpressions) * IMPRESSIONS_WEIGHT
      : 0;

    const rankScore = evalScore + impressionsBonus - FRESHNESS_DECAY_PER_HOUR * ageHours;
    return { ...c, rankScore };
  });

  // Sort descending by rank score
  scored.sort((a, b) => b.rankScore - a.rankScore);

  // Log for visibility
  console.log(`[candidateRanker] ${scored.length} candidates:`);
  for (const c of scored.slice(0, 10)) {
    const ageHours = ((now - c.createdAt.getTime()) / (1000 * 60 * 60)).toFixed(1);
    const impressions = c.tweetImpressions ? `${(c.tweetImpressions / 1000).toFixed(0)}K` : "?";
    console.log(
      `  ${c.pipelineRunId.slice(0, 8)} | score=${c.rankScore.toFixed(3)} | age=${ageHours}h | eval=${c.scores.evaluation?.toFixed(2) ?? "?"} | impressions=${impressions}`
    );
  }
  if (scored.length > 10) {
    console.log(`  ... and ${scored.length - 10} more`);
  }

  return scored;
}
