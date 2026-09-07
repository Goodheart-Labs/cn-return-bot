import { RANKING_POLICY_TEST } from "../ab-testing/abTestsData";
import { pickVariantName } from "../ab-testing/abTests";
import { getScorer, type Scorer } from "./scorers";

// One pick per run. A forced pick (CLI or replay) wins; otherwise sample by weight.
export function pickRankingPolicy(forced: string | undefined, rng: () => number = Math.random): string {
  return pickVariantName(RANKING_POLICY_TEST, forced, rng);
}

export const CONTROL_POLICY = "velocity_only";

// The control arm keeps today's behaviour exactly; only a non-control policy re-ranks.
export function activeScorer(policy: string): Scorer | null {
  return policy === CONTROL_POLICY ? null : getScorer(policy);
}
