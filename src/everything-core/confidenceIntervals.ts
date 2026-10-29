// Confidence-interval maths for the A/B comparison panel. These are pure
// functions with no React in them. See confidenceIntervals.test.ts for worked
// examples.
//
// Two shapes of metric need two formulas. A plain proportion of k out of n uses
// the Wilson score interval. A difference between two proportions drawn from
// the same sample, such as helpful minus unhelpful, uses an interval on the
// mean score instead.

export interface Interval {
  point: number; // The point estimate.
  lo: number; // The lower bound.
  hi: number; // The upper bound.
}

// The z multiplier for each two-sided confidence level we support.
export const Z_BY_LEVEL = { 90: 1.645, 95: 1.96, 99: 2.576 } as const;
export type ConfidenceLevel = keyof typeof Z_BY_LEVEL;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * The Wilson score interval for a binomial proportion of k out of n. It always
 * stays inside 0 and 1. It also behaves well for a small n or an extreme p,
 * where the normal approximation falls apart.
 * When n is zero it returns an interval of zero width. Callers are expected to
 * treat that case as "no data" before ever getting here.
 */
export function proportionCI(k: number, n: number, z: number): Interval {
  if (n <= 0) return { point: 0, lo: 0, hi: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const halfWidth = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { point: p, lo: clamp01(center - halfWidth), hi: clamp01(center + halfWidth) };
}

/**
 * The interval for the difference `(kA − kB) / n`. A and B are two categories
 * that exclude each other, counted over the same n observations. Helpful versus
 * unhelpful among one set of notes is the case we use it for.
 * Score every observation +1 for A, −1 for B, and 0 for neither. The metric is
 * then the mean of those scores, so this is a normal interval on that mean. Its
 * variance works out to the multinomial variance of a difference of
 * proportions, which is [pA(1−pA) + pB(1−pB) + 2·pA·pB] / n.
 * The bounds are clamped to the range −1 to 1.
 */
export function proportionDiffCI(kA: number, kB: number, n: number, z: number): Interval {
  if (n <= 0) return { point: 0, lo: 0, hi: 0 };
  const d = (kA - kB) / n;
  const variance = (kA + kB) / n - d * d; // The sample variance of those scores.
  const se = Math.sqrt(Math.max(0, variance) / n);
  const halfWidth = z * se;
  return {
    point: d,
    lo: Math.max(-1, d - halfWidth),
    hi: Math.min(1, d + halfWidth),
  };
}

/**
 * The interval for a ratio of a total cost to a count, such as the cost per
 * helpful note. The count is the rare and random part, so we treat it as
 * Poisson, where the variance is about equal to the count itself. We then carry
 * that uncertainty over to the ratio with the delta method on the log scale,
 * holding the total cost fixed. The result is the always-positive and
 * asymmetric interval (C/k) · exp(±z/√k).
 * When the count or the cost is not positive it returns an interval of zero
 * width. Callers are expected to treat those cases as "no data".
 */
export function costPerCountCI(totalCost: number, count: number, z: number): Interval {
  if (count <= 0 || totalCost <= 0) return { point: 0, lo: 0, hi: 0 };
  const point = totalCost / count;
  const rel = Math.exp(z / Math.sqrt(count));
  return { point, lo: point / rel, hi: point * rel };
}
