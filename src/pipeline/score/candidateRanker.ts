/**
 * Candidate Ranker
 *
 * Disabled — submission now happens inline sorted by eval score directly.
 * Previously ranked candidates by eval score + freshness decay for the
 * two-phase candidate queue.
 */

/*
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

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function rankCandidates(candidates: CandidateForRanking[]): RankedCandidate[] {
  if (candidates.length === 0) return [];

  const now = Date.now();

  const scored: RankedCandidate[] = candidates.map((c) => {
    const ageHours = (now - c.createdAt.getTime()) / (1000 * 60 * 60);
    const evalScore = c.scores.evaluation !== undefined
      ? sigmoid(c.scores.evaluation)
      : sigmoid(-1);
    const rankScore = evalScore - FRESHNESS_DECAY_PER_HOUR * ageHours;
    return { ...c, rankScore };
  });

  scored.sort((a, b) => b.rankScore - a.rankScore);

  console.log(`[candidateRanker] ${scored.length} candidates:`);
  for (const c of scored.slice(0, 10)) {
    const ageHours = ((now - c.createdAt.getTime()) / (1000 * 60 * 60)).toFixed(1);
    console.log(
      `  ${c.pipelineRunId.slice(0, 8)} | score=${c.rankScore.toFixed(3)} | age=${ageHours}h | eval=${c.scores.evaluation?.toFixed(2) ?? "?"}`
    );
  }
  if (scored.length > 10) {
    console.log(`  ... and ${scored.length - 10} more`);
  }

  return scored;
}
*/
