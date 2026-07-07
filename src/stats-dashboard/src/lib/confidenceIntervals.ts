// Confidence-interval math for the A/B comparison panel. Pure functions, no
// React — see confidenceIntervals.test.ts for worked examples.
//
// Two metric shapes need two formulas:
//   - a simple proportion (k of n)        → Wilson score interval
//   - a difference of two proportions     → score-mean interval
//     drawn from the SAME sample (helpful − unhelpful)

export interface Interval {
  point: number; // point estimate
  lo: number; // lower bound
  hi: number; // upper bound
}

// z multipliers for the supported two-sided confidence levels.
export const Z_BY_LEVEL = { 90: 1.645, 95: 1.96, 99: 2.576 } as const;
export type ConfidenceLevel = keyof typeof Z_BY_LEVEL;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Wilson score interval for a binomial proportion `k / n`. Stays within [0, 1]
 * and behaves at small n / extreme p where the normal approximation breaks.
 * Returns a zero-width interval at the raw rate when n === 0 (caller should
 * treat n === 0 as "no data" upstream).
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
 * Interval for the difference `(kA − kB) / n` where A and B are two mutually
 * exclusive categories of the SAME n observations (e.g. helpful vs unhelpful
 * among the same notes). Each observation scores +1 (A), −1 (B), or 0 (neither);
 * the metric is the mean score, so this is a normal interval on that mean. Its
 * variance equals the multinomial difference-of-proportions variance
 * [pA(1−pA) + pB(1−pB) + 2·pA·pB] / n. Bounds clamp to [−1, 1].
 */
export function proportionDiffCI(kA: number, kB: number, n: number, z: number): Interval {
  if (n <= 0) return { point: 0, lo: 0, hi: 0 };
  const d = (kA - kB) / n;
  const variance = (kA + kB) / n - d * d; // sample variance of the ±1/0 scores
  const se = Math.sqrt(Math.max(0, variance) / n);
  const halfWidth = z * se;
  return {
    point: d,
    lo: Math.max(-1, d - halfWidth),
    hi: Math.min(1, d + halfWidth),
  };
}

/**
 * Interval for a "total cost / count" ratio (e.g. cost per helpful note). The
 * count is the rare, random quantity, so we treat it as Poisson (variance ≈
 * count) and propagate to the ratio via the delta method on the log scale,
 * holding total cost fixed. That gives an always-positive, asymmetric interval:
 * (C/k) · exp(±z/√k). Returns a zero interval when count or cost is non-positive
 * (caller should gate those as "no data").
 */
export function costPerCountCI(totalCost: number, count: number, z: number): Interval {
  if (count <= 0 || totalCost <= 0) return { point: 0, lo: 0, hi: 0 };
  const point = totalCost / count;
  const rel = Math.exp(z / Math.sqrt(count));
  return { point, lo: point / rel, hi: point * rel };
}
