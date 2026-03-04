/**
 * Candidate Ranker
 *
 * Scores and selects the best candidate notes for submission.
 * Uses a weighted composite of prediction scores with freshness decay,
 * then softmax sampling so we mostly pick the best but occasionally
 * explore lower-ranked candidates to gather data.
 */

// Composite score weights
// eval has most data (n=119); trust/llm have high correlation but tiny samples (n=9, n=7)
const WEIGHT_EVAL = 0.6;
const WEIGHT_SOURCE_TRUST = 0.2;
const WEIGHT_LLM_HELPFULNESS = 0.2;

// Freshness: score penalty per hour of age
const FRESHNESS_DECAY_PER_HOUR = 0.02;

// Softmax temperature: lower = more greedy, higher = more exploratory
const TEMPERATURE = 0.3;

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
    sourceTrust?: number;
    llmHelpfulness?: number;
    sourceVerification?: number;
  };
}

export interface RankedCandidate extends CandidateForRanking {
  compositeScore: number;
  freshnessAdjustedScore: number;
}

/**
 * Sigmoid function to normalize unbounded eval scores to 0-1 range.
 * eval scores are typically in [-3, 3] range.
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute composite score for a single candidate.
 */
function computeCompositeScore(candidate: CandidateForRanking): number {
  let score = 0;
  let totalWeight = 0;

  // Missing eval defaults to sigmoid(-1) ≈ 0.27 — "unknown, assume below average"
  const evalNormalized = candidate.scores.evaluation !== undefined
    ? sigmoid(candidate.scores.evaluation)
    : sigmoid(-1);
  score += WEIGHT_EVAL * evalNormalized;
  totalWeight += WEIGHT_EVAL;

  if (candidate.scores.sourceTrust !== undefined) {
    score += WEIGHT_SOURCE_TRUST * candidate.scores.sourceTrust;
    totalWeight += WEIGHT_SOURCE_TRUST;
  }

  if (candidate.scores.llmHelpfulness !== undefined) {
    score += WEIGHT_LLM_HELPFULNESS * candidate.scores.llmHelpfulness;
    totalWeight += WEIGHT_LLM_HELPFULNESS;
  }

  // Normalize by total weight so missing scores don't penalize
  return totalWeight > 0 ? score / totalWeight : 0;
}

/**
 * Apply freshness decay based on candidate age.
 */
function applyFreshnessDecay(compositeScore: number, createdAt: Date): number {
  const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  return compositeScore - FRESHNESS_DECAY_PER_HOUR * ageHours;
}

/**
 * Softmax sampling: pick one candidate probabilistically,
 * weighted by their scores. Temperature controls greediness.
 */
function softmaxSample(candidates: RankedCandidate[]): RankedCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // Compute softmax probabilities
  const maxScore = Math.max(...candidates.map((c) => c.freshnessAdjustedScore));
  const exps = candidates.map((c) =>
    Math.exp((c.freshnessAdjustedScore - maxScore) / TEMPERATURE)
  );
  const sumExp = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / sumExp);

  // Sample
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < candidates.length; i++) {
    cumulative += probs[i]!;
    if (r <= cumulative) return candidates[i]!;
  }

  return candidates[candidates.length - 1]!;
}

/**
 * Rank all candidates and return them in submission order.
 * Uses softmax sampling to pick each successive candidate
 * (sampling without replacement).
 */
export function rankCandidates(candidates: CandidateForRanking[]): RankedCandidate[] {
  if (candidates.length === 0) return [];

  // Score all candidates
  const scored: RankedCandidate[] = candidates.map((c) => {
    const compositeScore = computeCompositeScore(c);
    const freshnessAdjustedScore = applyFreshnessDecay(compositeScore, c.createdAt);
    return { ...c, compositeScore, freshnessAdjustedScore };
  });

  // Log scores for visibility
  const sorted = [...scored].sort((a, b) => b.freshnessAdjustedScore - a.freshnessAdjustedScore);
  console.log(`[candidateRanker] ${sorted.length} candidates:`);
  for (const c of sorted.slice(0, 10)) {
    const ageHours = ((Date.now() - c.createdAt.getTime()) / (1000 * 60 * 60)).toFixed(1);
    console.log(
      `  ${c.pipelineRunId.slice(0, 8)} | composite=${c.compositeScore.toFixed(3)} | adjusted=${c.freshnessAdjustedScore.toFixed(3)} | age=${ageHours}h | eval=${c.scores.evaluation?.toFixed(2) ?? "?"} trust=${c.scores.sourceTrust?.toFixed(2) ?? "?"} llm=${c.scores.llmHelpfulness?.toFixed(2) ?? "?"}`
    );
  }
  if (sorted.length > 10) {
    console.log(`  ... and ${sorted.length - 10} more`);
  }

  // Softmax sample without replacement to build ranked order
  const ranked: RankedCandidate[] = [];
  const remaining = [...scored];

  while (remaining.length > 0) {
    const pick = softmaxSample(remaining);
    if (!pick) break;
    ranked.push(pick);
    const idx = remaining.findIndex((c) => c.pipelineRunId === pick.pipelineRunId);
    if (idx >= 0) remaining.splice(idx, 1);
  }

  return ranked;
}
