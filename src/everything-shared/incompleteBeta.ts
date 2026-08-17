/** The regularized incomplete beta function I_x(a, b). It is the cumulative
 *  distribution function of Beta(a, b).
 *
 *  It is built from a Lanczos approximation of the log-gamma function and the
 *  standard continued-fraction expansion. We write it out here rather than pull in a
 *  package. The donation model needs a Beta tail on every vote, and the published
 *  page runs under a strict content security policy that allows no external
 *  requests, so a dependency would only add bundle weight.
 */

const LANCZOS_G = 7;
const LANCZOS_BASE = 0.99999999999980993;
const LANCZOS_COEFFICIENTS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x: number): number {
  // Reflection formula keeps the series in its convergent range.
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  const series = LANCZOS_COEFFICIENTS.reduce((sum, c, i) => sum + c / (z + i + 1), LANCZOS_BASE);
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(series);
}

const MAX_ITERATIONS = 300;
const RELATIVE_TOLERANCE = 3e-14;
/** This value only guards against a division by zero in the recurrence. Its exact
 *  magnitude carries no meaning. */
const TINY = 1e-300;

/** The continued fraction for I_x(a, b). It converges quickly when x is below
 *  (a+1)/(a+b+2). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let result = d;

  for (let m = 1; m <= MAX_ITERATIONS; m++) {
    const m2 = 2 * m;
    // This is the even step of the recurrence.
    let numerator = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + numerator / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    result *= d * c;
    // This is the odd step of the recurrence.
    numerator = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + numerator / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const step = d * c;
    result *= step;
    if (Math.abs(step - 1) < RELATIVE_TOLERANCE) break;
  }
  return result;
}

export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x),
  );
  // Use the mirrored series on the far side, where the fraction converges faster.
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}
