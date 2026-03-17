/**
 * Candidate Ranker
 *
 * Ranks candidates by X API evaluation score with freshness decay.
 * When capped, submits the highest-scoring recent candidates first.
 *
 * Previously used a composite of LLM-scored bridging/saysWrong/sourceCount,
 * but analysis of 334 resolved notes showed those signals have zero correlation
 * with H/NH outcome on our own notes (r < 0.08 for all). Removed Mar 2026.
 */

// Freshness: score penalty per hour of age
const FRESHNESS_DECAY_PER_HOUR = 0.02;

export interface CandidateForRanking {
  pipelineRunId: string;
  tweetId: string;
  noteText: string;
  sourceUrl: string;
  botId: string;
  createdAt: Date;
  searchResults: string;
  tweetText: string;
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
 * Rank all candidates by eval score + freshness decay.
 * Candidates without eval scores go last (sorted by freshness among themselves).
 */
export function rankCandidates(candidates: CandidateForRanking[]): RankedCandidate[] {
  if (candidates.length === 0) return [];

  const now = Date.now();

  const scored: RankedCandidate[] = candidates.map((c) => {
    const ageHours = (now - c.createdAt.getTime()) / (1000 * 60 * 60);
    const evalScore = c.scores.evaluation !== undefined ? sigmoid(c.scores.evaluation) : sigmoid(-1); // ~0.27, "unknown, assume below average"
    const rankScore = evalScore - FRESHNESS_DECAY_PER_HOUR * ageHours;
    return { ...c, rankScore };
  });

  // Sort descending by rank score
  scored.sort((a, b) => b.rankScore - a.rankScore);

  // Log for visibility
  console.log(`[candidateRanker] ${scored.length} candidates:`);
  for (const c of scored.slice(0, 10)) {
    const ageHours = ((now - c.createdAt.getTime()) / (1000 * 60 * 60)).toFixed(1);
    console.log(
      `  ${c.pipelineRunId.slice(0, 8)} | score=${c.rankScore.toFixed(3)} | age=${ageHours}h | eval=${c.scores.evaluation?.toFixed(2) ?? "?"}`,
    );
  }
  if (scored.length > 10) {
    console.log(`  ... and ${scored.length - 10} more`);
  }

  return scored;
}
