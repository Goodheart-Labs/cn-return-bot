/**
 * Daily monitor for the velocity-floor experiment (read-only).
 *
 * Merged 2026-07-21T02:25Z (PR #288, fa6fb9b). Run once a day through the
 * week-end review (~2026-07-24) to drive the per-dial keep/revert call:
 *
 *   1. Funnel/day — written notes, submitted (topic vs regular), floor-cut,
 *      cap-cut. The idle-capacity signal lives here: floor-cuts piling up on a
 *      day with NO cap-cuts and low submissions means the floor (not the cap)
 *      is binding — the decision-table case for lowering the 30k floor.
 *   2. Floor-cut velocities — near-miss (≥ half the floor) vs deep cuts.
 *      Velocity is recomputed from frozen first-sight impressions ÷ age at the
 *      run's created_at, so it is only faithful for a tweet's FIRST run;
 *      cooldown re-runs are marked.
 *   3. Topic supply/day vs the dial-3 fallback rule: needs_note sightings
 *      clearing the 4k topic floor. Written rule: <5/day for 2 consecutive
 *      days → lower MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR to 2_000.
 *   4. Reserve fill — topic submissions/day vs MISINFO_RESERVE_24H = 5.
 *   5. Ratings arriving (public dump, ~24h lag; Helpful takes days) for every
 *      note submitted since 2026-07-17 — covers the pre-experiment topic
 *      cohort AND the experiment cohort. Expect zeros for the newest days.
 *
 * No cost column: LLM spend isn't recorded per run; watch OpenRouter directly.
 *
 *   bun run src/scripts_rob/2026_07_21_daily_monitor/run.ts
 */

import { SupabaseLogger } from "../../api/supabaseClient";

const EXP_START = "2026-07-21T02:25:09Z";
const RATINGS_COHORT_START = "2026-07-17";
const REGULAR_FLOOR = 30_000;
const TOPIC_FLOOR = 4_000;
const RESERVE = 5;
const MIN_AGE_H = 0.25;

const logger = new SupabaseLogger();
const chunk = <T,>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const day = (iso: string) => iso.slice(0, 10);
const fmtV = (v: number | null) => (v == null ? "?" : v >= 1000 ? `${(v / 1000).toFixed(1)}K/h` : `${Math.round(v)}/h`);

// ── Load ─────────────────────────────────────────────────────────────────────
interface Run { id: string; tweet_id: string; created_at: string; outcome: string | null; outcome_reason: string | null }
const runs = await logger.fetchAllRows<Run>(
  (c) => c.from("pipeline_runs").select("id, tweet_id, created_at, outcome, outcome_reason").gte("created_at", EXP_START),
  "id", "runs since experiment start");

const sightings = await logger.fetchAllRows<{
  id: number; tweet_id: string; needs_note: boolean | null; evaluated_at: string | null; processed_run_id: string | null;
}>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id, needs_note, evaluated_at, processed_run_id"),
  "id", "sightings");
const misinfoTweets = new Set(sightings.filter((s) => s.processed_run_id).map((s) => s.tweet_id));

const notes = await logger.fetchAllRows<{ note_id: string; tweet_id: string; cn_status: string | null; submitted_at: string | null }>(
  (c) => c.from("notes").select("note_id, tweet_id, cn_status, submitted_at").gte("submitted_at", RATINGS_COHORT_START),
  "note_id", "notes since 7/17");

const tweetIds = [...new Set([
  ...runs.map((r) => r.tweet_id),
  ...sightings.filter((s) => s.needs_note).map((s) => s.tweet_id),
  ...notes.map((n) => n.tweet_id),
])];
const tweetById = new Map<string, { impressions: number | null; posted_at: string | null; first_seen_at: string | null }>();
for (const b of chunk(tweetIds, 150)) {
  for (const t of await logger.fetchAllRows<any>(
    (c) => c.from("tweets").select("tweet_id, impressions, posted_at, first_seen_at").in("tweet_id", b), "tweet_id")) {
    tweetById.set(t.tweet_id, t);
  }
}

/** Velocity at `asOfIso` from frozen first-sight impressions (null if unknown). */
function velocityAt(tweetId: string, asOfIso: string): number | null {
  const t = tweetById.get(tweetId);
  if (t?.impressions == null || !t?.posted_at) return null;
  const ageH = (new Date(asOfIso).getTime() - new Date(t.posted_at).getTime()) / 3.6e6;
  return t.impressions / Math.max(ageH, MIN_AGE_H);
}

// First run per tweet in the window (velocity only faithful there).
const firstRun = new Map<string, string>();
for (const r of [...runs].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
  if (!firstRun.has(r.tweet_id)) firstRun.set(r.tweet_id, r.id);
}

// ── 1. Funnel per day ────────────────────────────────────────────────────────
const days = [...new Set(runs.map((r) => day(r.created_at)))].sort();
console.log(`\n== 1. funnel/day since ${EXP_START} (floors: regular ${fmtV(REGULAR_FLOOR)}, topic ${fmtV(TOPIC_FLOOR)}; reserve ${RESERVE}/24h) ==`);
console.log("day         written  submitted (topic+reg)  floor-cut  cap-cut  candidate");
for (const d of days) {
  const dr = runs.filter((r) => day(r.created_at) === d);
  const sub = dr.filter((r) => r.outcome === "submitted");
  const subTopic = sub.filter((r) => misinfoTweets.has(r.tweet_id)).length;
  const floor = dr.filter((r) => r.outcome_reason === "below_velocity_floor").length;
  const cap = dr.filter((r) => r.outcome_reason === "daily_limit_reached").length;
  const cand = dr.filter((r) => r.outcome === "candidate").length;
  const written = sub.length + floor + cap + cand;
  const idle = floor > 0 && cap === 0 ? "  ← floor binding, cap idle?" : "";
  console.log(
    `${d}  ${String(written).padStart(7)}  ${String(sub.length).padStart(9)} (${subTopic}+${sub.length - subTopic})` +
    `  ${String(floor).padStart(9)}  ${String(cap).padStart(7)}  ${String(cand).padStart(9)}${idle}`,
  );
}

// ── 2. Floor-cut velocities ──────────────────────────────────────────────────
console.log(`\n== 2. floor-cut detail (near-miss = within 2x of the ${fmtV(REGULAR_FLOOR)} floor) ==`);
for (const r of runs.filter((x) => x.outcome_reason === "below_velocity_floor").sort((a, b) => a.created_at.localeCompare(b.created_at))) {
  const v = velocityAt(r.tweet_id, r.created_at);
  const stale = firstRun.get(r.tweet_id) !== r.id ? " [cooldown re-run — velocity stale]" : "";
  const near = v != null && v >= REGULAR_FLOOR / 2 ? " NEAR-MISS" : "";
  console.log(`  ${r.created_at.slice(0, 16)}  vel=${fmtV(v).padStart(9)}  tweet ${r.tweet_id}${near}${stale}`);
}

// ── 3. Topic supply vs dial-3 fallback rule ──────────────────────────────────
console.log(`\n== 3. topic supply/day (needs_note sightings clearing the ${fmtV(TOPIC_FLOOR)} topic floor at first sight) ==`);
const needsNote = sightings.filter((s) => s.needs_note && s.evaluated_at && s.evaluated_at >= EXP_START);
const supplyByDay = new Map<string, { above: number; below: number; unknown: number }>();
for (const s of needsNote) {
  const d = day(s.evaluated_at!);
  const t = tweetById.get(s.tweet_id);
  const v = t?.first_seen_at ? velocityAt(s.tweet_id, t.first_seen_at) : null;
  const row = supplyByDay.get(d) ?? { above: 0, below: 0, unknown: 0 };
  if (v == null) row.unknown++; else if (v >= TOPIC_FLOOR) row.above++; else row.below++;
  supplyByDay.set(d, row);
}
console.log("day         >=floor  <floor  unknown-vel(fails open)");
for (const [d, s] of [...supplyByDay.entries()].sort()) {
  const warn = s.above + s.unknown < RESERVE ? `  ← under ${RESERVE}/day (2 consecutive days → lower floor to 2K/h)` : "";
  console.log(`${d}  ${String(s.above).padStart(7)}  ${String(s.below).padStart(6)}  ${String(s.unknown).padStart(7)}${warn}`);
}
if (supplyByDay.size === 0) console.log("  (no needs_note sightings evaluated since experiment start)");

// ── 4 & 5. Submitted notes + ratings (public dump, ~24h lag) ─────────────────
const ratings = new Map<string, number>();
for (const b of chunk(notes.map((n) => n.note_id), 150)) {
  for (const r of await logger.fetchAllRows<any>(
    (c) => c.from("note_ratings_from_public_dump")
      .select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count").in("note_id", b), "note_id")) {
    ratings.set(r.note_id, (r.helpful_count ?? 0) + (r.somewhat_helpful_count ?? 0) + (r.not_helpful_count ?? 0));
  }
}
console.log(`\n== 4. submitted notes since ${RATINGS_COHORT_START} — ratings from public dump (~24h lag; Helpful takes days) ==`);
console.log("submitted         cohort    vel@submit  ratings  status");
for (const n of notes.sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""))) {
  const cohort = misinfoTweets.has(n.tweet_id) ? "topic  " : "regular";
  const v = n.submitted_at ? velocityAt(n.tweet_id, n.submitted_at) : null;
  const exp = n.submitted_at && n.submitted_at >= EXP_START ? "*" : " ";
  console.log(`${(n.submitted_at ?? "?").slice(0, 16)}${exp} ${cohort}  ${fmtV(v).padStart(10)}  ${String(ratings.get(n.note_id) ?? 0).padStart(7)}  ${n.cn_status ?? "?"}`);
}
console.log(`(* = experiment cohort, submitted after the merge)`);
const rated = notes.filter((n) => (ratings.get(n.note_id) ?? 0) > 0).length;
console.log(`rated so far: ${rated}/${notes.length}`);
