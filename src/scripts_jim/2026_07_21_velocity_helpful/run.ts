/**
 * Replicate the velocity → P(rated helpful) analysis (read-only).
 *
 * Question: does a post's velocity (impressions/hour at first sight) predict
 * whether its note ends up CURRENTLY_RATED_HELPFUL?
 *
 * Method (mirrors window B of scripts_rob/2026_07_20_velocity_floor_sim):
 *   - Settled notes = submitted before SETTLED_CUTOFF (ratings have had time to
 *     land; recent notes are still in flight and would dilute the signal).
 *   - Settled velocity = impressions frozen at first insert ÷ age at first
 *     sight (first_seen_at − posted_at), clamped to VELOCITY_MIN_AGE_HOURS.
 *     This matches the sim's historical proxy for velocity-at-fetch.
 *   - Bin across the whole velocity range; report P(helpful) and P(rated at
 *     all) per bin with Wilson 95% intervals, plus the point-biserial
 *     correlation of helpful vs log10(velocity).
 *
 *   bun run src/scripts_jim/2026_07_21_velocity_helpful/run.ts
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { VELOCITY_MIN_AGE_HOURS } from "../../pipeline/utils/velocity";
import { formatCount } from "../../pipeline/orchestration/utils/tweetSorting";

const SETTLED_CUTOFF = "2026-07-17";
const REGULAR_FLOOR = 30_000;
const TOPIC_FLOOR = 4_000;
const HELPFUL = "CURRENTLY_RATED_HELPFUL";
const NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL";
// Bin upper edges (impressions/hour); last bin is everything above the top edge.
const BIN_EDGES = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000, 125_000, 250_000, 500_000, Infinity];

const logger = new SupabaseLogger();
const chunk = <T,>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const pct = (a: number, b: number) => (b ? ((100 * a) / b) : NaN);

/** Wilson score interval half-widths for a binomial rate (z=1.96). */
function wilson(successes: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: NaN, hi: NaN };
  const z = 1.96, p = successes / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { lo: 100 * (center - margin), hi: 100 * (center + margin) };
}

// ── Pull settled notes ──────────────────────────────────────────────────────
const notes = await logger.fetchAllRows<{ note_id: string; tweet_id: string; cn_status: string | null; submitted_at: string | null }>(
  (c) => c.from("notes").select("note_id, tweet_id, cn_status, submitted_at").not("submitted_at", "is", null),
  "note_id", "submitted notes");
const settled = notes.filter((n) => n.submitted_at!.slice(0, 10) < SETTLED_CUTOFF);

// ── Pull the tweets those notes are on ──────────────────────────────────────
const tweetById = new Map<string, { impressions: number | null; posted_at: string | null; first_seen_at: string | null }>();
for (const b of chunk([...new Set(settled.map((n) => n.tweet_id))], 150)) {
  for (const t of await logger.fetchAllRows<any>(
    (c) => c.from("tweets").select("tweet_id, impressions, posted_at, first_seen_at").in("tweet_id", b), "tweet_id"))
    tweetById.set(t.tweet_id, t);
}

// ── Join → (velocity, outcome) observations ─────────────────────────────────
interface Obs { v: number; helpful: boolean; rated: boolean }
const obs: Obs[] = [];
let missingTweet = 0, missingData = 0;
for (const n of settled) {
  const t = tweetById.get(n.tweet_id);
  if (!t) { missingTweet++; continue; }
  if (t.impressions == null || !t.posted_at || !t.first_seen_at) { missingData++; continue; }
  const ageH = Math.max((new Date(t.first_seen_at).getTime() - new Date(t.posted_at).getTime()) / 3.6e6, VELOCITY_MIN_AGE_HOURS);
  const v = t.impressions / ageH;
  if (!Number.isFinite(v)) { missingData++; continue; }
  obs.push({ v, helpful: n.cn_status === HELPFUL, rated: n.cn_status === HELPFUL || n.cn_status === NOT_HELPFUL });
}

console.log(`\nsettled notes (submitted before ${SETTLED_CUTOFF}): ${settled.length}`);
console.log(`  usable (velocity computable): ${obs.length}   [dropped: ${missingTweet} no-tweet-row, ${missingData} missing impressions/timestamps]`);

// ── Status distribution ─────────────────────────────────────────────────────
const statusCounts = new Map<string, number>();
for (const n of settled) statusCounts.set(n.cn_status ?? "null", (statusCounts.get(n.cn_status ?? "null") ?? 0) + 1);
console.log(`\nstatus distribution (all settled):`);
for (const [s, c] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${s.padEnd(28)} ${String(c).padStart(6)}  ${pct(c, settled.length).toFixed(1)}%`);

// ── Binned helpful rate ─────────────────────────────────────────────────────
const binOf = (v: number) => BIN_EDGES.findIndex((edge) => v < edge);
const bins = BIN_EDGES.map(() => ({ n: 0, helpful: 0, rated: 0 }));
for (const o of obs) { const i = binOf(o.v); bins[i].n++; if (o.helpful) bins[i].helpful++; if (o.rated) bins[i].rated++; }

console.log(`\nP(rated helpful) by velocity bin  [Wilson 95% CI]:`);
console.log(`velocity/h            n     helpful%   95% CI          rated%   helpful|rated%`);
let loEdge = 0;
for (let i = 0; i < bins.length; i++) {
  const b = bins[i], hiEdge = BIN_EDGES[i];
  const label = hiEdge === Infinity ? `${formatCount(loEdge)}+` : `${formatCount(loEdge)}–${formatCount(hiEdge)}`;
  const w = wilson(b.helpful, b.n);
  const ci = b.n ? `[${w.lo.toFixed(1)}, ${w.hi.toFixed(1)}]` : "";
  const hGivenRated = b.rated ? pct(b.helpful, b.rated).toFixed(1) : "–";
  console.log(
    `${label.padEnd(18)} ${String(b.n).padStart(6)}   ${(b.n ? pct(b.helpful, b.n).toFixed(1) : "–").padStart(6)}%   ${ci.padEnd(16)} ${(b.n ? pct(b.rated, b.n).toFixed(1) : "–").padStart(6)}%   ${hGivenRated.padStart(9)}%`,
  );
  loEdge = hiEdge;
}

// ── Floor summaries (match the sim) + lift ──────────────────────────────────
const rate = (arr: Obs[]) => ({ n: arr.length, h: arr.filter((o) => o.helpful).length });
const summary = (label: string, arr: Obs[]) => {
  const r = rate(arr); console.log(`  ${label.padEnd(34)} ${pct(r.h, r.n).toFixed(1)}%  (${r.h}/${r.n})`);
};
console.log(`\nfloor comparisons:`);
summary("baseline (all usable)", obs);
summary(`above regular floor ${formatCount(REGULAR_FLOOR)}/h`, obs.filter((o) => o.v >= REGULAR_FLOOR));
summary(`below regular floor ${formatCount(REGULAR_FLOOR)}/h`, obs.filter((o) => o.v < REGULAR_FLOOR));
summary(`above topic floor ${formatCount(TOPIC_FLOOR)}/h`, obs.filter((o) => o.v >= TOPIC_FLOOR));
summary(`below topic floor ${formatCount(TOPIC_FLOOR)}/h`, obs.filter((o) => o.v < TOPIC_FLOOR));

if (obs.length === 0) { console.log(`\nNo usable observations — velocity source coverage is zero. Stopping.`); process.exit(0); }

// ── Point-biserial correlation of helpful vs log10(velocity) ────────────────
const xs = obs.map((o) => Math.log10(Math.max(o.v, 1)));
const ys = obs.map((o) => (o.helpful ? 1 : 0));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const mx = mean(xs), my = mean(ys);
let cov = 0, vx = 0, vy = 0;
for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
const r = cov / Math.sqrt(vx * vy);
console.log(`\ncorrelation(helpful, log10 velocity): r = ${r.toFixed(3)}  (n=${obs.length})`);

// ── Quintile lift ───────────────────────────────────────────────────────────
const sorted = [...obs].sort((a, b) => a.v - b.v);
const q = (frac: number) => sorted[Math.floor(frac * (sorted.length - 1))].v;
const bottomQ = sorted.slice(0, Math.floor(sorted.length / 5));
const topQ = sorted.slice(Math.floor(4 * sorted.length / 5));
console.log(`\nquintiles (velocity/h cutpoints): p20=${formatCount(Math.round(q(0.2)))}  p50=${formatCount(Math.round(q(0.5)))}  p80=${formatCount(Math.round(q(0.8)))}`);
const bq = rate(bottomQ), tq = rate(topQ);
console.log(`  bottom velocity quintile helpful%: ${pct(bq.h, bq.n).toFixed(1)}%  (${bq.h}/${bq.n})`);
console.log(`  top velocity quintile helpful%:    ${pct(tq.h, tq.n).toFixed(1)}%  (${tq.h}/${tq.n})`);
console.log(`  lift (top ÷ bottom): ${(pct(tq.h, tq.n) / pct(bq.h, bq.n)).toFixed(1)}×`);
