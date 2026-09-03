import { flagCount, type RankFeatures } from "./features";

export interface Scorer {
  name: string;
  // Higher is better. Admission uses post-only features; submit adds the eval score.
  scoreAdmission(f: RankFeatures): number;
  scoreSubmit(f: RankFeatures, evalScore: number | null): number;
}

const logVelocity = (v: number | null) => (v === null ? 0 : Math.min(9, Math.log10(Math.max(v, 1))));
const clampEval = (e: number | null) => (e === null ? 0 : Math.max(-5, Math.min(5, e)));

// Today's order: feed tier first (small before large before xl), velocity within a tier.
export const velocityOnly: Scorer = {
  name: "velocity_only",
  scoreAdmission: (f) => (3 - (f.tierRank ?? 3)) * 10 + logVelocity(f.velocityPerHour),
  scoreSubmit: (f) => logVelocity(f.velocityPerHour),
};

export const flagsThenEval: Scorer = {
  name: "flags_then_eval",
  scoreAdmission: (f) => flagCount(f) * 10 + logVelocity(f.velocityPerHour),
  scoreSubmit: (f, evalScore) => flagCount(f) * 10 + clampEval(evalScore),
};

export const SCORERS: Record<string, Scorer> = {
  [velocityOnly.name]: velocityOnly,
  [flagsThenEval.name]: flagsThenEval,
};

export function getScorer(name: string): Scorer {
  const s = SCORERS[name];
  if (!s) throw new Error(`Unknown scorer "${name}". Known: ${Object.keys(SCORERS).join(", ")}`);
  return s;
}

export function shadowScores(f: RankFeatures): Record<string, number> {
  return Object.fromEntries(Object.values(SCORERS).map((s) => [s.name, s.scoreAdmission(f)]));
}
