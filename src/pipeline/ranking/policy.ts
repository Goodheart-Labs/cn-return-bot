import { RANKING_POLICY_TEST } from "../ab-testing/abTestsData";
import { getScorer, type Scorer } from "./scorers";

// One pick per run. A forced pick (CLI or replay) wins; otherwise sample by weight.
export function pickRankingPolicy(forced: string | undefined, rng: () => number = Math.random): string {
  if (forced) return forced;
  const live = RANKING_POLICY_TEST.variants.filter((v) => v.weight > 0);
  const total = live.reduce((n, v) => n + v.weight, 0);
  let r = rng() * total;
  for (const v of live) {
    r -= v.weight;
    if (r < 0) return v.variant.name;
  }
  return live[live.length - 1]?.variant.name ?? RANKING_POLICY_TEST.defaultVariant!;
}

export const CONTROL_POLICY = "velocity_only";

// The control arm keeps today's behaviour exactly; only a non-control policy re-ranks.
export function activeScorer(policy: string): Scorer | null {
  return policy === CONTROL_POLICY ? null : getScorer(policy);
}
