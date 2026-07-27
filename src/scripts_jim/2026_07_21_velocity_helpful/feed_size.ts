/**
 * Does decision-time tweet velocity explain the rating-rate gap between the
 * small and large feeds?
 *
 * Read-only. Feed buckets follow the project's existing convention:
 *   Small = small; Large = large | xl | xxl.
 * Runs with no recorded feed_size are excluded rather than backfilled.
 *
 *   bun run src/scripts_jim/2026_07_21_velocity_helpful/feed_size.ts
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { VELOCITY_MIN_AGE_HOURS } from "../../pipeline/utils/velocity";

const OUTCOME_CUTOFF = "2026-07-17";
const HELPFUL = "CURRENTLY_RATED_HELPFUL";
const NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL";
const BIN_EDGES = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000, 125_000, 250_000, 500_000, Infinity];
const LARGE_TIERS = new Set(["large", "xl", "xxl"]);

type Feed = "small" | "large";
type Obs = {
  feed: Feed;
  tier: string;
  velocity: number;
  resolved: boolean;
  anyRating: boolean;
  fiveRatings: boolean;
  helpful: boolean;
};

const logger = new SupabaseLogger();
const chunk = <T,>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const pct = (k: number, n: number) => n ? 100 * k / n : NaN;
const fmtPct = (k: number, n: number) => n ? `${pct(k, n).toFixed(1)}%` : "–";
const fmtVelocity = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v < 10_000 ? 1 : 0)}K` : v.toFixed(0);
const quantile = (xs: number[], q: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(q * (sorted.length - 1))] ?? NaN;
};
const binOf = (v: number) => BIN_EDGES.findIndex((edge) => v < edge);

const notes = await logger.fetchAllRows<{
  note_id: string;
  tweet_id: string;
  cn_status: string | null;
  submitted_at: string;
}>(
  (c) => c.from("notes")
    .select("note_id, tweet_id, cn_status, submitted_at")
    .not("submitted_at", "is", null)
    .lt("submitted_at", OUTCOME_CUTOFF),
  "note_id", "feed-velocity.notes",
);

const runs = await logger.fetchAllRows<{
  id: string;
  note_id: string | null;
  ab_test_picks: Record<string, string> | null;
  created_at: string;
}>(
  (c) => c.from("pipeline_runs")
    .select("id, note_id, ab_test_picks, created_at")
    .eq("outcome", "submitted")
    .not("note_id", "is", null)
    .lt("created_at", OUTCOME_CUTOFF),
  "id", "feed-velocity.runs",
);

// If a note somehow has multiple submitted rows, use the latest one.
runs.sort((a, b) => a.created_at.localeCompare(b.created_at));
const tierByNote = new Map<string, string | null>();
for (const r of runs) tierByNote.set(r.note_id!, r.ab_test_picks?.feed_size ?? null);

const ratingRows = await logger.fetchAllRows<{
  note_id: string;
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
}>(
  (c) => c.from("note_ratings_from_public_dump")
    .select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count"),
  "note_id", "feed-velocity.ratings",
);
const ratingCountByNote = new Map(ratingRows.map((r) => [
  r.note_id,
  r.helpful_count + r.somewhat_helpful_count + r.not_helpful_count,
]));

const tweetIds = [...new Set(notes.map((n) => n.tweet_id))];
const tweetById = new Map<string, {
  tweet_id: string;
  impressions: number | null;
  posted_at: string | null;
  first_seen_at: string | null;
}>();
for (const ids of chunk(tweetIds, 150)) {
  const rows = await logger.fetchAllRows<any>(
    (c) => c.from("tweets")
      .select("tweet_id, impressions, posted_at, first_seen_at")
      .in("tweet_id", ids),
    "tweet_id", "feed-velocity.tweets",
  );
  for (const row of rows) tweetById.set(row.tweet_id, row);
}

const obs: Obs[] = [];
let missingFeed = 0, otherFeed = 0, missingTweet = 0, missingVelocity = 0;
const tierCounts = new Map<string, number>();
for (const note of notes) {
  const tier = tierByNote.get(note.note_id);
  if (tier == null) { missingFeed++; continue; }
  const feed: Feed | null = tier === "small" ? "small" : LARGE_TIERS.has(tier) ? "large" : null;
  if (!feed) { otherFeed++; continue; }
  const tweet = tweetById.get(note.tweet_id);
  if (!tweet) { missingTweet++; continue; }
  if (tweet.impressions == null || !tweet.posted_at || !tweet.first_seen_at) { missingVelocity++; continue; }
  const rawAgeH = (new Date(tweet.first_seen_at).getTime() - new Date(tweet.posted_at).getTime()) / 3.6e6;
  if (!(rawAgeH > 0)) { missingVelocity++; continue; }
  const velocity = tweet.impressions / Math.max(rawAgeH, VELOCITY_MIN_AGE_HOURS);
  if (!Number.isFinite(velocity)) { missingVelocity++; continue; }
  const ratingCount = ratingCountByNote.get(note.note_id) ?? 0;
  obs.push({
    feed, tier, velocity,
    resolved: note.cn_status === HELPFUL || note.cn_status === NOT_HELPFUL,
    anyRating: ratingCount > 0,
    fiveRatings: ratingCount >= 5,
    helpful: note.cn_status === HELPFUL,
  });
  tierCounts.set(tier, (tierCounts.get(tier) ?? 0) + 1);
}

console.log(`\n=== Decision-time velocity vs rating, submitted before ${OUTCOME_CUTOFF} ===`);
console.log(`usable n=${obs.length}; excluded: missing feed=${missingFeed}, other feed=${otherFeed}, missing tweet=${missingTweet}, missing velocity=${missingVelocity}`);
console.log(`usable tiers: ${[...tierCounts].sort().map(([k, v]) => `${k}=${v}`).join(", ")}`);

for (const feed of ["overall", "small", "large"] as const) {
  const xs = feed === "overall" ? obs : obs.filter((o) => o.feed === feed);
  const resolved = xs.filter((o) => o.resolved);
  console.log(`${feed.padEnd(7)} n=${String(xs.length).padStart(4)}  median=${fmtVelocity(quantile(xs.map((o) => o.velocity), .5))}/h  resolved=${fmtPct(resolved.length, xs.length)}  any-vote=${fmtPct(xs.filter((o) => o.anyRating).length, xs.length)}  >=5=${fmtPct(xs.filter((o) => o.fiveRatings).length, xs.length)}  helpful=${fmtPct(xs.filter((o) => o.helpful).length, xs.length)}  helpful|resolved=${fmtPct(resolved.filter((o) => o.helpful).length, resolved.length)}`);
}

console.log(`\nvelocity/h       overall resolved    small resolved      large resolved      overall any-vote    overall >=5         overall helpful`);
let lo = 0;
for (let i = 0; i < BIN_EDGES.length; i++) {
  const hi = BIN_EDGES[i];
  const label = hi === Infinity ? `${fmtVelocity(lo)}+` : `${fmtVelocity(lo)}–${fmtVelocity(hi)}`;
  const all = obs.filter((o) => binOf(o.velocity) === i);
  const small = all.filter((o) => o.feed === "small");
  const large = all.filter((o) => o.feed === "large");
  const cell = (xs: Obs[], key: "resolved" | "anyRating" | "fiveRatings" | "helpful") =>
    `${fmtPct(xs.filter((o) => o[key]).length, xs.length)} (n=${xs.length})`;
  console.log(`${label.padEnd(15)} ${cell(all, "resolved").padEnd(19)} ${cell(small, "resolved").padEnd(19)} ${cell(large, "resolved").padEnd(19)} ${cell(all, "anyRating").padEnd(19)} ${cell(all, "fiveRatings").padEnd(19)} ${cell(all, "helpful")}`);
  lo = hi;
}

// Symmetric Kitagawa decomposition across the fixed velocity bins:
// raw feed gap = velocity-composition component + within-bin component.
function decompose(
  rows: Obs[],
  key: "resolved" | "anyRating" | "fiveRatings" | "helpful",
  edges = BIN_EDGES,
) {
  const small = rows.filter((o) => o.feed === "small");
  const large = rows.filter((o) => o.feed === "large");
  const raw = pct(small.filter((o) => o[key]).length, small.length) - pct(large.filter((o) => o[key]).length, large.length);
  let composition = 0, within = 0;
  const localBinOf = (v: number) => edges.findIndex((edge) => v < edge);
  for (let i = 0; i < edges.length; i++) {
    const s = small.filter((o) => localBinOf(o.velocity) === i);
    const l = large.filter((o) => localBinOf(o.velocity) === i);
    if (!s.length || !l.length) return null;
    const ws = s.length / small.length, wl = l.length / large.length;
    const rs = pct(s.filter((o) => o[key]).length, s.length);
    const rl = pct(l.filter((o) => o[key]).length, l.length);
    composition += 0.5 * (ws - wl) * (rs + rl);
    within += 0.5 * (ws + wl) * (rs - rl);
  }
  return { raw, composition, within, explained: 100 * composition / raw };
}

console.log(`\n=== Small minus Large gap: fixed-bin decomposition ===`);
console.log(`metric          raw gap    velocity composition    within-bin residual    share explained`);
for (const [label, key] of [["resolved", "resolved"], ["any vote", "anyRating"], [">=5 ratings", "fiveRatings"], ["helpful", "helpful"]] as const) {
  const d = decompose(obs, key);
  if (!d) {
    console.log(`${label.padEnd(15)} cannot decompose: at least one bin has an empty feed cohort`);
    continue;
  }
  console.log(`${label.padEnd(15)} ${d.raw.toFixed(2).padStart(7)} pp  ${d.composition.toFixed(2).padStart(10)} pp          ${d.within.toFixed(2).padStart(10)} pp          ${d.explained.toFixed(1).padStart(8)}%`);
}

const velocityValues = obs.map((o) => o.velocity);
const decileEdges = [...Array(9)].map((_, i) => quantile(velocityValues, (i + 1) / 10)).concat(Infinity);
const quintileEdges = [...Array(4)].map((_, i) => quantile(velocityValues, (i + 1) / 5)).concat(Infinity);
console.log(`\nSensitivity to velocity binning (share of raw gap attributed to velocity composition):`);
for (const [label, key] of [["resolved", "resolved"], ["helpful", "helpful"]] as const) {
  const q5 = decompose(obs, key, quintileEdges);
  const q10 = decompose(obs, key, decileEdges);
  const fixed = decompose(obs, key, BIN_EDGES);
  console.log(`  ${label.padEnd(9)} quintiles=${q5?.explained.toFixed(1) ?? "–"}%  deciles=${q10?.explained.toFixed(1) ?? "–"}%  fixed bins=${fixed?.explained.toFixed(1) ?? "–"}%`);
}

const exactLarge = obs.filter((o) => o.tier === "small" || o.tier === "large");
console.log(`\nSensitivity excluding XL/XXL (Small vs exact Large only; n=${exactLarge.length}):`);
for (const [label, key] of [["resolved", "resolved"], ["helpful", "helpful"]] as const) {
  const d = decompose(exactLarge, key);
  console.log(`  ${label.padEnd(9)} raw=${d?.raw.toFixed(2) ?? "–"} pp  velocity=${d?.composition.toFixed(2) ?? "–"} pp  explained=${d?.explained.toFixed(1) ?? "–"}%`);
}

// Fine velocity strata for judging the feed effect conditional on velocity.
// Equal-count pooled bins keep velocity ranges tight without creating dozens
// of nearly empty tail cells. Values equal to a boundary stay in the lower
// stratum, matching the quantile construction.
const fineEdges = [...Array(19)]
  .map((_, i) => quantile(velocityValues, (i + 1) / 20))
  .filter((edge, i, edges) => i === 0 || edge > edges[i - 1]!)
  .concat(Infinity);
const fineBinOf = (v: number) => fineEdges.findIndex((edge) => v <= edge);
console.log(`\n=== Fine velocity strata: resolved (Helpful or Not Helpful) ===`);
console.log(`velocity/h          overall n  overall %    small rated/n  small %    large rated/n  large %    S-L gap`);
let fineLo = 0;
let mhNumer = 0, mhDenom = 0, cmhObservedMinusExpected = 0, cmhVariance = 0;
let mhVarTerm1 = 0, mhVarTerm2 = 0, mhVarTerm3 = 0;
let overlapWeight = 0, overlapWeightedDiff = 0, overlapVarianceNumer = 0;
for (let i = 0; i < fineEdges.length; i++) {
  const hi = fineEdges[i]!;
  const rows = obs.filter((o) => fineBinOf(o.velocity) === i);
  const small = rows.filter((o) => o.feed === "small");
  const large = rows.filter((o) => o.feed === "large");
  const sr = small.filter((o) => o.resolved).length;
  const lr = large.filter((o) => o.resolved).length;
  const totalRated = sr + lr;
  const label = hi === Infinity ? `${fmtVelocity(fineLo)}+` : `${fmtVelocity(fineLo)}–${fmtVelocity(hi)}`;
  const gap = pct(sr, small.length) - pct(lr, large.length);
  console.log(`${label.padEnd(19)} ${String(rows.length).padStart(5)}      ${fmtPct(totalRated, rows.length).padStart(6)}    ${`${sr}/${small.length}`.padStart(12)}  ${fmtPct(sr, small.length).padStart(7)}    ${`${lr}/${large.length}`.padStart(13)}  ${fmtPct(lr, large.length).padStart(7)}    ${Number.isFinite(gap) ? `${gap >= 0 ? "+" : ""}${gap.toFixed(1)} pp` : "–"}`);

  // Mantel-Haenszel common odds ratio and CMH test for feed association,
  // stratified by the fine velocity bins.
  const n = rows.length;
  if (small.length && large.length && n > 1) {
    const su = small.length - sr, lu = large.length - lr;
    mhNumer += sr * lu / n;
    mhDenom += su * lr / n;
    mhVarTerm1 += (sr + lu) * sr * lu / (n * n);
    mhVarTerm2 += ((sr + lu) * su * lr + (su + lr) * sr * lu) / (n * n);
    mhVarTerm3 += (su + lr) * su * lr / (n * n);
    const expectedSmallRated = small.length * totalRated / n;
    const totalUnrated = n - totalRated;
    const variance = small.length * large.length * totalRated * totalUnrated / (n * n * (n - 1));
    cmhObservedMinusExpected += sr - expectedSmallRated;
    cmhVariance += variance;

    const smallRate = sr / small.length, largeRate = lr / large.length;
    const weight = small.length * large.length / n;
    const diffVariance = smallRate * (1 - smallRate) / small.length + largeRate * (1 - largeRate) / large.length;
    overlapWeight += weight;
    overlapWeightedDiff += weight * (smallRate - largeRate);
    overlapVarianceNumer += weight * weight * diffVariance;
  }
  fineLo = hi;
}
const mhOr = mhNumer / mhDenom;
const cmhZ = cmhObservedMinusExpected / Math.sqrt(cmhVariance);
const mhLogSe = Math.sqrt(
  mhVarTerm1 / (2 * mhNumer * mhNumer)
  + mhVarTerm2 / (2 * mhNumer * mhDenom)
  + mhVarTerm3 / (2 * mhDenom * mhDenom)
);
const mhLo = Math.exp(Math.log(mhOr) - 1.96 * mhLogSe);
const mhHi = Math.exp(Math.log(mhOr) + 1.96 * mhLogSe);
const overlapDiff = 100 * overlapWeightedDiff / overlapWeight;
const overlapSe = 100 * Math.sqrt(overlapVarianceNumer) / overlapWeight;
const erf = (x: number) => {
  const sign = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
};
const cmhP = 1 - erf(Math.abs(cmhZ) / Math.sqrt(2));
console.log(`\nVelocity-stratified feed effect:`);
console.log(`  Mantel-Haenszel OR=${mhOr.toFixed(2)} (95% CI ${mhLo.toFixed(2)}–${mhHi.toFixed(2)}), CMH z=${cmhZ.toFixed(2)}, p=${cmhP.toFixed(3)}.`);
console.log(`  Overlap-weighted adjusted risk difference=${overlapDiff >= 0 ? "+" : ""}${overlapDiff.toFixed(2)} pp (approx. 95% CI ${(overlapDiff - 1.96 * overlapSe).toFixed(2)} to ${(overlapDiff + 1.96 * overlapSe).toFixed(2)} pp).`);
