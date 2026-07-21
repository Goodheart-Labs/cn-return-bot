/**
 * Slider-data export for the velocity threshold-picker artifact: everything a
 * client-side "choose the floor" tool needs, in one JSON.
 *
 *  - outcomes: every note with settled ratings (submitted before the lag
 *    cutoff) → [velocity, totalRatings, isHelpful, isMisinfo]
 *  - supply: every note WRITTEN in the last 30 days (submitted + candidate +
 *    dropped-at-cap) → [velocity, dayOffset, isMisinfo] — the per-day pool a
 *    floor would filter
 *  - submittedPerDay: actual submissions/day over the same window (the
 *    capacity a floor must keep fed)
 *
 * Velocity = impressions ÷ hours-since-post at first sight (age clamped ≥15
 * min), identical to analyze.ts. Read-only.
 *
 *   bun run src/scripts_rob/2026_07_20_rating_velocity/export_slider.ts --out slider.json
 */

import { SupabaseLogger } from "../../api/supabaseClient";

const logger = new SupabaseLogger();
const outFlag = process.argv.indexOf("--out");
const outPath = (outFlag !== -1 ? process.argv[outFlag + 1] : undefined) ?? "slider.json";

const OUTCOME_CUTOFF = "2026-07-17";
const SUPPLY_DAYS = 30;
const HELPFUL = "CURRENTLY_RATED_HELPFUL";
const CLAMP_AGE_H = 0.25;
const now = Date.now();
const supplySince = new Date(now - SUPPLY_DAYS * 864e5).toISOString();

const chunk = <T,>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

function velocity(impressions: number | null | undefined, postedAt: string | null | undefined, seenAt: string | null | undefined): number | null {
  if (impressions == null || !postedAt || !seenAt) return null;
  const ageH = (new Date(seenAt).getTime() - new Date(postedAt).getTime()) / 3.6e6;
  if (!(ageH > 0)) return null;
  return impressions / Math.max(ageH, CLAMP_AGE_H);
}

// ── Segment tag: any-topic curated (XXL pre-pass) tweet ids ─────────────────
const misinfoSightings = await logger.fetchAllRows<{ id: number; tweet_id: string }>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id").not("processed_run_id", "is", null),
  "id", "misinfo processed");
const misinfoTweetIds = new Set(misinfoSightings.map((s) => s.tweet_id));

// ── Outcomes: notes + ratings + tweet velocity ──────────────────────────────
const notes = await logger.fetchAllRows<{ note_id: string; tweet_id: string; cn_status: string | null; submitted_at: string | null }>(
  (c) => c.from("notes").select("note_id, tweet_id, cn_status, submitted_at"), "note_id", "notes");
const ratingRows = await logger.fetchAllRows<{ note_id: string; helpful_count: number; somewhat_helpful_count: number; not_helpful_count: number }>(
  (c) => c.from("note_ratings_from_public_dump").select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count"),
  "note_id", "ratings");
const ratingsById = new Map(ratingRows.map((r) => [r.note_id, r.helpful_count + r.somewhat_helpful_count + r.not_helpful_count]));

// ── Supply: written notes in the last 30 days ───────────────────────────────
interface Run { id: string; tweet_id: string; created_at: string }
const supplyRuns: Run[] = [
  ...await logger.fetchAllRows<Run>(
    (c) => c.from("pipeline_runs").select("id, tweet_id, created_at")
      .gte("created_at", supplySince).in("outcome", ["submitted", "candidate"]),
    "id", "supply submitted+candidate"),
  ...await logger.fetchAllRows<Run>(
    (c) => c.from("pipeline_runs").select("id, tweet_id, created_at")
      .gte("created_at", supplySince).eq("outcome_reason", "daily_limit_reached"),
    "id", "supply cap-dropped"),
];

// ── Ever-shown population: every tweet where a note was written or attempted ─
// Rejected runs excluding the "we looked and declined" reasons — i.e. tweets
// the pipeline judged note-worthy. Restricted to pre-cutoff so others' notes
// had time to be rated. "Shown" uses current CRH status from the public dump
// (ours via notes.cn_status; others via competing_notes, which also carries
// the helpful-only "missed opportunity" rows for tweets we rejected).
const rejectedRuns = await logger.fetchAllRows<{ id: string; tweet_id: string }>(
  (c) => c.from("pipeline_runs").select("id, tweet_id")
    .eq("outcome", "rejected")
    .not("outcome_reason", "in", "(prefilter_no_note,no_correction_needed)")
    .lt("created_at", OUTCOME_CUTOFF),
  "id", "rejected note-attempted runs");
const competing = await logger.fetchAllRows<{ note_id: string; tweet_id: string; current_status: string | null }>(
  (c) => c.from("competing_notes").select("note_id, tweet_id, current_status"),
  "note_id", "competing notes");
const shownByOthers = new Set(competing.filter((c) => c.current_status === HELPFUL).map((c) => c.tweet_id));
const shownByUs = new Set(notes.filter((n) => n.cn_status === HELPFUL).map((n) => n.tweet_id));

// ── Tweets for all sets ─────────────────────────────────────────────────────
const allTweetIds = [...new Set([...notes.map((n) => n.tweet_id), ...supplyRuns.map((r) => r.tweet_id), ...rejectedRuns.map((r) => r.tweet_id)])];
const tweetById = new Map<string, any>();
for (const b of chunk(allTweetIds, 150)) {
  for (const t of await logger.fetchAllRows<any>(
    (c) => c.from("tweets").select("tweet_id, impressions, posted_at, first_seen_at").in("tweet_id", b), "tweet_id")) {
    tweetById.set(t.tweet_id, t);
  }
}

// ── Assemble ────────────────────────────────────────────────────────────────
// outcomes: [velocity, ratings, isHelpful, isMisinfo]
const outcomes: [number, number, number, number][] = [];
for (const n of notes) {
  if (!n.submitted_at || n.submitted_at.slice(0, 10) >= OUTCOME_CUTOFF) continue;
  const t = tweetById.get(n.tweet_id);
  const v = velocity(t?.impressions, t?.posted_at, t?.first_seen_at);
  if (v == null) continue;
  outcomes.push([Math.round(v), ratingsById.get(n.note_id) ?? 0, n.cn_status === HELPFUL ? 1 : 0, misinfoTweetIds.has(n.tweet_id) ? 1 : 0]);
}

// supply: [velocity, dayOffset (0 = today), isMisinfo]
const supply: [number, number, number][] = [];
for (const r of supplyRuns) {
  const t = tweetById.get(r.tweet_id);
  const v = velocity(t?.impressions, t?.posted_at, t?.first_seen_at);
  if (v == null) continue;
  const dayOffset = Math.floor((now - new Date(r.created_at).getTime()) / 864e5);
  supply.push([Math.round(v), dayOffset, misinfoTweetIds.has(r.tweet_id) ? 1 : 0]);
}

// actual submissions/day, same window
const submittedRecent = notes.filter((n) => n.submitted_at && n.submitted_at >= supplySince);
const perDay = new Map<string, number>();
for (const n of submittedRecent) {
  const d = n.submitted_at!.slice(0, 10);
  perDay.set(d, (perDay.get(d) ?? 0) + 1);
}
const submittedPerDay = [...perDay.entries()].sort().map(([day, count]) => ({ day, count }));

// shown: [velocity, flags] — flags bit 1 = any note shown (ours or others),
// bit 2 = ours shown, bit 4 = we submitted a note on it. One row per tweet;
// submitted classification wins over rejected.
const submittedTweetIds = new Set(
  notes.filter((n) => n.submitted_at && n.submitted_at.slice(0, 10) < OUTCOME_CUTOFF).map((n) => n.tweet_id));
const shownPopulation = new Set([...submittedTweetIds, ...rejectedRuns.map((r) => r.tweet_id)]);
const shown: [number, number][] = [];
for (const tweetId of shownPopulation) {
  const t = tweetById.get(tweetId);
  const v = velocity(t?.impressions, t?.posted_at, t?.first_seen_at);
  if (v == null) continue;
  const any = shownByOthers.has(tweetId) || shownByUs.has(tweetId) ? 1 : 0;
  const ours = shownByUs.has(tweetId) ? 2 : 0;
  const sub = submittedTweetIds.has(tweetId) ? 4 : 0;
  shown.push([Math.round(v), any + ours + sub]);
}

console.log(`[slider] outcomes ${outcomes.length} | supply ${supply.length} runs over ${SUPPLY_DAYS}d | submitted last ${SUPPLY_DAYS}d: ${submittedRecent.length}`);
console.log(`[slider] shown population ${shown.length} tweets (${shown.filter((s) => s[1] & 1).length} ever had a note shown; ${shown.filter((s) => s[1] & 2).length} ours)`);
await Bun.write(outPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  outcome_cutoff: OUTCOME_CUTOFF,
  supply_days: SUPPLY_DAYS,
  outcomes, supply, submittedPerDay, shown,
}));
console.log(`[slider] wrote ${outPath}`);
