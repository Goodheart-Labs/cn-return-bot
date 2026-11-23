import { flagCount, type FlagCuts, type RankFeatures } from "./features";

export interface Scorer {
  name: string;
  // Higher is better. Admission uses post-only features; submit adds the eval score.
  scoreAdmission(f: RankFeatures): number;
  scoreSubmit(f: RankFeatures, evalScore: number | null): number;
}

// Predicted views still to come when the post has a prediction, velocity when
// not. At admission all posts of a round are of one kind. At submission they
// can mix, for example a queued note from before GOO-863 with fresh ones, so
// the velocity_only arm's submit score compares unlike numbers then. With the
// note queue on, the note rater orders submissions, so that score is only
// logged.
const logReach = (f: RankFeatures) => {
  const v = f.viewsToCome ?? f.velocityPerHour;
  return v === null ? 0 : Math.min(9, Math.log10(Math.max(v, 1)));
};
const clampEval = (e: number | null) => (e === null ? 0 : Math.max(-5, Math.min(5, e)));

// The ladder's order: feed tier first (small before large before xl), then
// predicted views still to come within a tier. The name is from when it was
// velocity, and it stays because it is the A/B test's arm name.
export const velocityOnly: Scorer = {
  name: "velocity_only",
  scoreAdmission: (f) => (3 - (f.tierRank ?? 3)) * 10 + logReach(f),
  scoreSubmit: (f) => logReach(f),
};

export const FLAG_CUTS_2026_08: FlagCuts = {
  followerCeiling: 1_000_000,
  velocityFloorPerHour: 15_000,
  ageMinHours: 3,
  ageMaxHours: 12,
  fittedOn: "2026-08-10..2026-08-30",
};

export function makeFlagsThenEval(name: string, cuts: FlagCuts): Scorer & { cuts: FlagCuts } {
  return {
    name,
    cuts,
    scoreAdmission: (f) => flagCount(f, cuts) * 10 + logReach(f),
    scoreSubmit: (f, evalScore) => flagCount(f, cuts) * 10 + clampEval(evalScore),
  };
}

export const flagsThenEval = makeFlagsThenEval("flags_then_eval", FLAG_CUTS_2026_08);

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
