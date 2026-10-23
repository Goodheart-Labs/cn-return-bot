/* Empirical Bayes creator score that allows for clustered readers (GOO-549).
 * x = readers of a post beyond the first, since every visited post has one.
 * Within a creator, Var(x) = phi * mean, with phi > 1 when readers arrive in
 * clusters such as one shared link. phi is estimated from the creators with
 * at least 2 posts. Across creators the true rates are Gamma(alpha, beta),
 * fitted by the method of moments after removing that noise. The score is the
 * posterior mean, 1 + (alpha * phi + sum x) / (beta * phi + n): a creator is
 * treated as if they also had beta * phi posts of the average creator. */
import { readFileSync } from "fs";
type Row = { creator: string; n: number; s: number; ss: number };
const rows = (JSON.parse(readFileSync(new URL("./perCreatorMoments.json", import.meta.url), "utf8")) as Row[]).map((r) => {
  const n = Number(r.n), s = Number(r.s) - n, ss = Number(r.ss) - 2 * Number(r.s) + n; // shift to x = r - 1
  return { creator: r.creator, n, s, ss, raw: Number(r.s) / n };
});
const multi = rows.filter((r) => r.n >= 2);
const withinSquares = multi.reduce((a, r) => a + (r.ss - (r.s * r.s) / r.n), 0);
const withinDegrees = multi.reduce((a, r) => a + r.n - 1, 0);
const multiMean = multi.reduce((a, r) => a + r.s, 0) / multi.reduce((a, r) => a + r.n, 0);
const phi = withinSquares / withinDegrees / multiMean;
const mu = rows.reduce((a, r) => a + r.s, 0) / rows.reduce((a, r) => a + r.n, 0);
const tau2 = rows.reduce((a, r) => a + (r.s / r.n - mu) ** 2 - (phi * mu) / r.n, 0) / rows.length;
const beta = mu / tau2, alpha = mu * beta;
const priorPosts = beta * phi;
console.log(`phi ${phi.toFixed(2)} (1 would mean independent readers), mean extra readers ${mu.toFixed(3)}, spread of true rates ${tau2.toFixed(3)}`);
console.log(`prior worth ${priorPosts.toFixed(1)} average posts\n`);
const score = (r: (typeof rows)[number]) => 1 + (alpha * phi + r.s) / (priorPosts + r.n);
const top = [...rows].sort((a, b) => score(b) - score(a)).slice(0, 30);
for (const [i, r] of top.entries()) console.log(`${String(i + 1).padStart(3)} ${r.creator.replace(/^https:\/\/(www\.)?/, "").slice(0, 38).padEnd(38)} ${score(r).toFixed(2)}  (raw ${r.raw.toFixed(2)} over ${r.n})`);
const MIN_SCORE_TO_WALK = 1.5;
console.log(`\ncreators at or above ${MIN_SCORE_TO_WALK}: raw with >= 2 posts ${rows.filter((r) => r.raw >= MIN_SCORE_TO_WALK && r.n >= 2).length}, shrunk ${rows.filter((r) => score(r) >= MIN_SCORE_TO_WALK).length}`);
