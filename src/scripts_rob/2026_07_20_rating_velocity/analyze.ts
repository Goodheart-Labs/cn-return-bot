/**
 * Rating-velocity analysis: does a tweet's SPEED at the moment we first see it
 * (impressions accumulated per hour since posting — both known at decision
 * time) predict whether the note we write will actually get rated?
 *
 * Motivation (Nathan, 7/20 call): we may be spending scarce submission slots
 * on notes that will never be rated. Everything here uses only information
 * available at the moment of the submit decision: tweets.impressions is frozen
 * at first insertion (bulkInsertNewTweets is insert-only), so impressions ÷
 * (first_seen_at − posted_at) is exactly the speed we saw when we chose the
 * tweet. Outcomes come from note_ratings_from_public_dump (fresh daily; the
 * legacy notes.rating_count went stale 2026-03) and notes.cn_status.
 *
 * Also: note_request_suggestions (X's per-post user note requests, captured in
 * tweets.raw_tweet since 2026-06-16 / #184 but never used) as a second
 * decision-time signal.
 *
 * Read-only. Run:
 *   bun run src/scripts_rob/2026_07_20_rating_velocity/analyze.ts [--out results.json]
 */

import { SupabaseLogger } from "../../api/supabaseClient";

const logger = new SupabaseLogger();
const outFlag = process.argv.indexOf("--out");
const outPath = outFlag !== -1 ? process.argv[outFlag + 1] : null;

// Ratings arrive with a public-dump lag (~1 day) and ramp over ~2–3 days:
// cohorts submitted 7/13–7/16 are 94–100% rated, 7/18+ still near 0%. Cut at
// 7/17 so "never rated" means "had time and still wasn't", not "too new".
const OUTCOME_CUTOFF = "2026-07-17";
const RAW_TWEET_SINCE = "2026-06-16"; // migration 045 / PR #184
const HELPFUL = "CURRENTLY_RATED_HELPFUL";
const NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL";

const chunk = <T,>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "–");
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
const fmtSpeed = (s: number) => (s >= 1e6 ? `${(s / 1e6).toFixed(1)}M` : s >= 1e3 ? `${(s / 1e3).toFixed(1)}k` : s.toFixed(0));

// ── Fetch ───────────────────────────────────────────────────────────────────
const notes = await logger.fetchAllRows<{ note_id: string; tweet_id: string; cn_status: string | null; submitted_at: string | null }>(
  (c) => c.from("notes").select("note_id, tweet_id, cn_status, submitted_at"),
  "note_id", "notes");

const ratingRows = await logger.fetchAllRows<{ note_id: string; helpful_count: number; somewhat_helpful_count: number; not_helpful_count: number }>(
  (c) => c.from("note_ratings_from_public_dump").select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count"),
  "note_id", "ratings");
const ratingsById = new Map(ratingRows.map((r) => [r.note_id, r.helpful_count + r.somewhat_helpful_count + r.not_helpful_count]));

const noteTweetIds = [...new Set(notes.map((n) => n.tweet_id))];
const tweets: { tweet_id: string; impressions: number | null; posted_at: string | null; first_seen_at: string | null }[] = [];
for (const b of chunk(noteTweetIds, 150)) {
  tweets.push(...await logger.fetchAllRows<any>(
    (c) => c.from("tweets").select("tweet_id, impressions, posted_at, first_seen_at").in("tweet_id", b),
    "tweet_id"));
}
const tweetById = new Map(tweets.map((t) => [t.tweet_id, t]));

// Note-request counts via JSON-path selection (never pulls the raw_tweet blob).
const nrs: { tweet_id: string; nrs: unknown[] | null }[] = [];
for (const b of chunk(noteTweetIds, 150)) {
  nrs.push(...await logger.fetchAllRows<any>(
    (c) => c.from("tweets").select("tweet_id, nrs:raw_tweet->note_request_suggestions").in("tweet_id", b),
    "tweet_id"));
}
const requestsById = new Map(nrs.map((r) => [r.tweet_id, Array.isArray(r.nrs) ? r.nrs.length : r.nrs == null ? null : 0]));

// Topic tweets: sighting-time impressions (the tweets rows for 39 of them were
// backfilled later, so their first_seen_at is not sighting time — sightings is
// the honest source here).
const sightings = await logger.fetchAllRows<{ id: number; tweet_id: string; impression_count: number | null; first_seen_at: string; processed_run_id: string | null }>(
  (c) => c.from("misinfo_monitoring_sightings")
    .select("id, tweet_id, impression_count, first_seen_at, processed_run_id")
    .eq("topic_id", "trump_election_security"),
  "id", "topic sightings");

// ── Assemble the decision-time dataset ──────────────────────────────────────
interface Obs { noteId: string; tweetId: string; speed: number; impressions: number; ageH: number; ratings: number; status: string | null; submittedAt: string; requests: number | null }
// Clamp age to one crawl period (15 min) rather than excluding young tweets:
// the misinfo pre-pass sights posts minutes after they're posted, and dropping
// them would bias the topic's speed profile toward its slow tail. Clamping
// makes very-young speeds conservative instead of absent.
const CLAMP_AGE_H = 0.25;

function speedOf(impressions: number | null | undefined, postedAt: string | null | undefined, seenAt: string | null | undefined): { speed: number; ageH: number } | null {
  if (impressions == null || !postedAt || !seenAt) return null;
  const rawAgeH = (new Date(seenAt).getTime() - new Date(postedAt).getTime()) / 3.6e6;
  if (!(rawAgeH > 0)) return null;
  const ageH = Math.max(rawAgeH, CLAMP_AGE_H);
  return { speed: impressions / ageH, ageH };
}

const all: Obs[] = [];
for (const n of notes) {
  if (!n.submitted_at) continue;
  const t = tweetById.get(n.tweet_id);
  const sp = speedOf(t?.impressions, t?.posted_at, t?.first_seen_at);
  if (!sp) continue;
  all.push({
    noteId: n.note_id, tweetId: n.tweet_id, speed: sp.speed, impressions: t!.impressions!,
    ageH: sp.ageH, ratings: ratingsById.get(n.note_id) ?? 0, status: n.cn_status,
    submittedAt: n.submitted_at, requests: requestsById.get(n.tweet_id) ?? null,
  });
}
const scored = all.filter((o) => o.submittedAt.slice(0, 10) < OUTCOME_CUTOFF);
scored.sort((a, b) => a.speed - b.speed);
console.log(`\n=== dataset: ${all.length} notes with decision-time speed; ${scored.length} old enough (< ${OUTCOME_CUTOFF}) to judge outcomes ===`);

// ── 1. Speed distribution ───────────────────────────────────────────────────
const speeds = scored.map((o) => o.speed);
console.log(`\n== 1. speed at decision time (impressions/hour), ${scored.length} notes ==`);
for (const q of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
  console.log(`  p${String(q * 100).padStart(3)}  ${fmtSpeed(quantile(speeds, q === 1 ? 0.9999 : q))}/h`);
}

// ── 2. Outcomes by speed quintile ───────────────────────────────────────────
console.log(`\n== 2. outcomes by speed quintile ==`);
console.log("quintile (speed range)      n    any rating  >=5 ratings  median  HELPFUL  NOT_HELPFUL");
const Q = 5, size = Math.floor(scored.length / Q);
const quintiles: any[] = [];
for (let i = 0; i < Q; i++) {
  const s = scored.slice(i * size, i === Q - 1 ? scored.length : (i + 1) * size);
  const med = s.map((o) => o.ratings).sort((a, b) => a - b)[Math.floor(s.length / 2)] ?? 0;
  const row = {
    range: `${fmtSpeed(s[0]!.speed)}–${fmtSpeed(s.at(-1)!.speed)}/h`, n: s.length,
    anyRating: pct(s.filter((o) => o.ratings > 0).length, s.length),
    five: pct(s.filter((o) => o.ratings >= 5).length, s.length),
    median: med,
    helpful: pct(s.filter((o) => o.status === HELPFUL).length, s.length),
    notHelpful: pct(s.filter((o) => o.status === NOT_HELPFUL).length, s.length),
  };
  quintiles.push(row);
  console.log(`  ${row.range.padEnd(24)} ${String(row.n).padStart(4)}  ${row.anyRating.padStart(9)}  ${row.five.padStart(10)}  ${String(row.median).padStart(6)}  ${row.helpful.padStart(7)}  ${row.notHelpful.padStart(10)}`);
}

// ── 3. Cutoff counterfactual: what would a floor have cost / saved? ─────────
console.log(`\n== 3. counterfactual speed floors ==`);
console.log("floor      skipped   of which HELPFUL (lost)  of which never-rated (waste saved)  HELPFUL kept");
const totalHelpful = scored.filter((o) => o.status === HELPFUL).length;
const cutoffs: any[] = [];
for (const q of [0.1, 0.2, 0.3, 0.4, 0.5]) {
  const floor = quantile(speeds, q);
  const below = scored.filter((o) => o.speed < floor);
  const lostHelpful = below.filter((o) => o.status === HELPFUL).length;
  const wasteSaved = below.filter((o) => o.ratings === 0).length;
  const row = {
    floor: `${fmtSpeed(floor)}/h (p${q * 100})`, skipped: below.length,
    lostHelpful, wasteSaved,
    helpfulKept: pct(totalHelpful - lostHelpful, totalHelpful),
  };
  cutoffs.push(row);
  console.log(`  ${row.floor.padEnd(16)} ${String(row.skipped).padStart(4)}  ${String(lostHelpful).padStart(10)} of ${totalHelpful}  ${String(wasteSaved).padStart(20)}  ${row.helpfulKept.padStart(12)}`);
}

// ── 4. Note requests as a decision-time signal (raw_tweet era only) ─────────
const reqEra = scored.filter((o) => o.submittedAt.slice(0, 10) >= RAW_TWEET_SINCE && o.requests !== null);
console.log(`\n== 4. note requests vs outcomes (${reqEra.length} notes since ${RAW_TWEET_SINCE} with raw_tweet) ==`);
console.log("requests   n    any rating  >=5 ratings  median  HELPFUL");
const reqBands: any[] = [];
for (const [label, f] of [["0", (r: number) => r === 0], ["1–2", (r: number) => r >= 1 && r <= 2], ["3+", (r: number) => r >= 3]] as const) {
  const s = reqEra.filter((o) => f(o.requests!));
  if (!s.length) continue;
  const med = s.map((o) => o.ratings).sort((a, b) => a - b)[Math.floor(s.length / 2)] ?? 0;
  const row = { band: label, n: s.length, anyRating: pct(s.filter((o) => o.ratings > 0).length, s.length), five: pct(s.filter((o) => o.ratings >= 5).length, s.length), median: med, helpful: pct(s.filter((o) => o.status === HELPFUL).length, s.length) };
  reqBands.push(row);
  console.log(`  ${label.padEnd(8)} ${String(s.length).padStart(4)}  ${row.anyRating.padStart(9)}  ${row.five.padStart(10)}  ${String(med).padStart(6)}  ${row.helpful.padStart(7)}`);
}

// ── 5. Recent submissions: how much of the cap goes below the floor? ────────
const recent = all.filter((o) => o.submittedAt >= "2026-07-06");
console.log(`\n== 5. last 14 days of submissions (${recent.length} notes) vs candidate floors ==`);
for (const q of [0.1, 0.25, 0.5]) {
  const floor = quantile(speeds, q);
  console.log(`  below ${fmtSpeed(floor)}/h (p${q * 100} of history): ${recent.filter((o) => o.speed < floor).length}/${recent.length} recent submissions`);
}

// ── 6. The election topic's speed profile ───────────────────────────────────
// Sighting-time speed for every processed topic tweet. posted_at comes from
// tweets — fetch the topic tweet_ids not already covered by the notes join.
const topicIds = [...new Set(sightings.filter((s) => s.processed_run_id).map((s) => s.tweet_id))]
  .filter((id) => !tweetById.has(id));
for (const b of chunk(topicIds, 150)) {
  for (const t of await logger.fetchAllRows<any>(
    (c) => c.from("tweets").select("tweet_id, impressions, posted_at, first_seen_at").in("tweet_id", b),
    "tweet_id")) {
    tweetById.set(t.tweet_id, t);
  }
}
const topicObs = sightings
  .filter((s) => s.processed_run_id)
  .map((s) => {
    const t = tweetById.get(s.tweet_id) as any;
    const sp = speedOf(s.impression_count, t?.posted_at, s.first_seen_at);
    return sp ? { tweetId: s.tweet_id, speed: sp.speed, ageH: sp.ageH } : null;
  })
  .filter((x): x is NonNullable<typeof x> => !!x)
  .sort((a, b) => a.speed - b.speed);
const topicSpeeds = topicObs.map((o) => o.speed);
console.log(`\n== 6. trump_election_security processed tweets: sighting-time speed (${topicObs.length} with data) ==`);
if (topicObs.length) {
  for (const q of [0.1, 0.25, 0.5, 0.75, 0.9]) console.log(`  p${String(q * 100).padStart(3)}  ${fmtSpeed(quantile(topicSpeeds, q))}/h`);
  const globalMedian = quantile(speeds, 0.5);
  console.log(`  → global historical median is ${fmtSpeed(globalMedian)}/h; ${pct(topicObs.filter((o) => o.speed >= globalMedian).length, topicObs.length)} of topic tweets are above it`);
}

// ── Export ──────────────────────────────────────────────────────────────────
if (outPath) {
  await Bun.write(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    outcome_cutoff: OUTCOME_CUTOFF,
    n_all: all.length, n_scored: scored.length,
    speed_percentiles: Object.fromEntries([0, 0.1, 0.25, 0.5, 0.75, 0.9].map((q) => [`p${q * 100}`, quantile(speeds, q)])),
    quintiles, cutoffs, request_bands: reqBands,
    recent: { n: recent.length, below_p25: recent.filter((o) => o.speed < quantile(speeds, 0.25)).length, below_p50: recent.filter((o) => o.speed < quantile(speeds, 0.5)).length },
    topic: { n: topicObs.length, percentiles: topicObs.length ? Object.fromEntries([0.1, 0.25, 0.5, 0.75, 0.9].map((q) => [`p${q * 100}`, quantile(topicSpeeds, q)])) : {} },
    scored_points: scored.map((o) => ({ s: Math.round(o.speed), r: o.ratings, h: o.status === HELPFUL ? 1 : o.status === NOT_HELPFUL ? -1 : 0, q: o.requests })),
    topic_points: topicObs.map((o) => Math.round(o.speed)),
  }, null, 1));
  console.log(`\n[analyze] wrote ${outPath}`);
}
