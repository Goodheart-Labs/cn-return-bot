/**
 * Offline replay of the velocity-floor experiment (read-only).
 *
 * TWO DATA WINDOWS — do not mix their numbers:
 *
 *  A. RECENT REPLAY (default last 7 days): every written note (submitted +
 *     candidate + dropped-at-cap), deduped to each tweet's FIRST run —
 *     tweets.impressions is frozen at first insert (insert-only upsert), so
 *     velocity is only faithful for the first run; cooldown re-runs would get
 *     stale numbers. These runs are fed through the REAL exported
 *     partitionByVelocityFloor. Mechanical
 *     what-would-have-happened only — NO outcome claims (these notes haven't
 *     settled; ratings lag ~24h+ and Helpful status takes days).
 *
 *  B. SETTLED OUTCOMES (9 months, submitted before 2026-07-17): the only
 *     window where Helpful rates mean anything. Produces the load-bearing
 *     "Helpful rate above the floor vs baseline" stat.
 *
 * Replay trick: the prod functions compute velocity as-of Date.now(), so each
 * synthetic post's created_at is SHIFTED to preserve its age at run time
 * (created' = now − (run.created_at − posted_at)). Impressions are unchanged.
 *
 * Approximations: misinfo partition via misinfo_monitoring_sightings
 * .processed_run_id (pipeline_runs has no topic_id); the per-day "new top K" is
 * ranked by velocity, since a replay cannot reproduce prod's pipeline order.
 *
 *   bun run src/scripts_rob/2026_07_20_velocity_floor_sim/run.ts [--days 7]
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { partitionByVelocityFloor, type Candidate } from "../../pipeline/orchestration/submitCandidates";
import { velocityPerHour, formatVelocity } from "../../pipeline/utils/velocity";
import type { Post } from "../../api/fetchEligiblePosts";
import type { ProcessTweetResult } from "../../pipeline/orchestration/processTweet";

const DAYS = (() => {
  const i = process.argv.indexOf("--days");
  return i !== -1 ? Number(process.argv[i + 1]) : 7;
})();
const SETTLED_CUTOFF = "2026-07-17";
const REGULAR_FLOOR = 30_000; // keep in sync with submitCandidates until the dial is final
const TOPIC_FLOOR = 4_000;    // keep in sync with generateMisinfoCandidates
const HELPFUL = "CURRENTLY_RATED_HELPFUL";

const logger = new SupabaseLogger();
const since = new Date(Date.now() - DAYS * 864e5).toISOString();
const chunk = <T,>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "–");

// ── Shared: misinfo tweet set (any topic) ───────────────────────────────────
const sightings = await logger.fetchAllRows<{ id: number; tweet_id: string; processed_run_id: string | null }>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id, processed_run_id").not("processed_run_id", "is", null),
  "id", "processed sightings");
const misinfoTweets = new Set(sightings.map((s) => s.tweet_id));

// ── Window A: recent replay ─────────────────────────────────────────────────
interface Run { id: string; tweet_id: string; created_at: string; outcome: string | null; outcome_reason: string | null }
const recentRuns: Run[] = [
  ...await logger.fetchAllRows<Run>(
    (c) => c.from("pipeline_runs").select("id, tweet_id, created_at, outcome, outcome_reason")
      .gte("created_at", since).in("outcome", ["submitted", "candidate"]),
    "id", "recent submitted+candidate"),
  ...await logger.fetchAllRows<Run>(
    (c) => c.from("pipeline_runs").select("id, tweet_id, created_at, outcome, outcome_reason")
      .gte("created_at", since).eq("outcome_reason", "daily_limit_reached"),
    "id", "recent cap-dropped"),
];
// First run per tweet only (velocity faithfulness — see header).
const firstRunByTweet = new Map<string, Run>();
for (const r of recentRuns.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
  if (!firstRunByTweet.has(r.tweet_id)) firstRunByTweet.set(r.tweet_id, r);
}
const runs = [...firstRunByTweet.values()];
console.log(`\n[sim] window A: ${recentRuns.length} written-note runs in last ${DAYS}d → ${runs.length} first-runs`);

const evalScores = new Map<string, number>();
for (const b of chunk(runs.map((r) => r.id), 100)) {
  for (const s of await logger.fetchAllRows<{ id: number; pipeline_run_id: string; score_value: number | null }>(
    (c) => c.from("pipeline_scores").select("id, pipeline_run_id, score_value")
      .eq("score_type", "evaluation").in("pipeline_run_id", b),
    "id")) {
    if (s.score_value != null) evalScores.set(s.pipeline_run_id, s.score_value);
  }
}

const tweetById = new Map<string, { impressions: number | null; posted_at: string | null }>();
const allTweetIds = [...new Set(runs.map((r) => r.tweet_id))];
for (const b of chunk(allTweetIds, 150)) {
  for (const t of await logger.fetchAllRows<any>(
    (c) => c.from("tweets").select("tweet_id, impressions, posted_at").in("tweet_id", b), "tweet_id")) {
    tweetById.set(t.tweet_id, t);
  }
}

/** Synthetic candidate whose age-at-run is preserved under Date.now(). */
function toCandidate(r: Run): Candidate | null {
  const t = tweetById.get(r.tweet_id);
  if (!t?.posted_at) return null;
  const ageMs = new Date(r.created_at).getTime() - new Date(t.posted_at).getTime();
  const shiftedCreatedAt = new Date(Date.now() - ageMs).toISOString();
  const post: Post = {
    id: r.tweet_id, author_id: "", created_at: shiftedCreatedAt, text: "", media: [],
    public_metrics: t.impressions == null ? undefined : { impression_count: t.impressions },
  };
  return {
    post,
    tweetResult: { evaluationScore: evalScores.get(r.id), pipelineRunId: r.id } as unknown as ProcessTweetResult,
    botId: "sim",
    isMisinfo: misinfoTweets.has(r.tweet_id),
  };
}

const byDay = new Map<string, Run[]>();
for (const r of runs) {
  const d = r.created_at.slice(0, 10);
  (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r);
}

console.log(`\n== A. per-day replay (floors: regular ${formatVelocity(REGULAR_FLOOR)}, topic ${formatVelocity(TOPIC_FLOOR)}; top-K ranked by velocity) ==`);
console.log("day        written  actual-sub  floor-cut  kept  topic>=floor  new-top-K(old∩new)");
for (const [day, dayRuns] of [...byDay.entries()].sort()) {
  const cands = dayRuns.map(toCandidate).filter((x): x is Candidate => !!x);
  const { kept, floorCut } = partitionByVelocityFloor(cands);
  const topicQualifying = cands.filter((c) => c.isMisinfo && (velocityPerHour(c.post) ?? Infinity) >= TOPIC_FLOOR).length;
  const actualSubmitted = new Set(dayRuns.filter((r) => r.outcome === "submitted").map((r) => r.tweet_id));
  const K = actualSubmitted.size;
  // Prod no longer sorts at submission (notes submit in pipeline order: misinfo
  // pre-pass, then the regular pass's selection ranking, then pangram). A replay
  // has no pipeline order to reproduce, so approximate the cut by velocity.
  const newTop = [...kept]
    .sort((a, b) => (velocityPerHour(b.post) ?? -Infinity) - (velocityPerHour(a.post) ?? -Infinity))
    .slice(0, K);
  const overlap = newTop.filter((c) => actualSubmitted.has(c.post.id)).length;
  console.log(
    `${day}  ${String(dayRuns.length).padStart(7)}  ${String(K).padStart(10)}  ${String(floorCut.length).padStart(9)}  ${String(kept.length).padStart(4)}  ${String(topicQualifying).padStart(12)}  K=${K}: ${overlap}/${K} same as actual`,
  );
}

// ── Window B: settled outcomes (9 months, pre-cutoff) ───────────────────────
const notes = await logger.fetchAllRows<{ note_id: string; tweet_id: string; cn_status: string | null; submitted_at: string | null }>(
  (c) => c.from("notes").select("note_id, tweet_id, cn_status, submitted_at"), "note_id", "notes");
const settled = notes.filter((n) => n.submitted_at && n.submitted_at.slice(0, 10) < SETTLED_CUTOFF);
const settledTweetIds = [...new Set(settled.map((n) => n.tweet_id))].filter((id) => !tweetById.has(id));
for (const b of chunk(settledTweetIds, 150)) {
  for (const t of await logger.fetchAllRows<any>(
    (c) => c.from("tweets").select("tweet_id, impressions, posted_at, first_seen_at").in("tweet_id", b), "tweet_id")) {
    tweetById.set(t.tweet_id, t);
  }
}
// Settled velocity: impressions frozen at first sight ÷ age at first sight.
const settledObs = settled.map((n) => {
  const t = tweetById.get(n.tweet_id) as any;
  if (t?.impressions == null || !t?.posted_at || !t?.first_seen_at) return null;
  const ageH = Math.max((new Date(t.first_seen_at).getTime() - new Date(t.posted_at).getTime()) / 3.6e6, 0.25);
  return { v: t.impressions / ageH, helpful: n.cn_status === HELPFUL };
}).filter((x): x is NonNullable<typeof x> => !!x);

const above = settledObs.filter((o) => o.v >= REGULAR_FLOOR);
const helpfulAbove = above.filter((o) => o.helpful).length;
const helpfulAll = settledObs.filter((o) => o.helpful).length;
console.log(`\n== B. settled outcomes (${settledObs.length} notes submitted before ${SETTLED_CUTOFF}) ==`);
console.log(`Helpful rate ABOVE ${formatVelocity(REGULAR_FLOOR)}: ${pct(helpfulAbove, above.length)} (${helpfulAbove}/${above.length})`);
console.log(`Helpful rate baseline (all):    ${pct(helpfulAll, settledObs.length)} (${helpfulAll}/${settledObs.length})`);
console.log(`Eventual-Helpful notes kept by the floor: ${pct(helpfulAbove, helpfulAll)}`);
console.log(`(Window A numbers are mechanical replay only — those notes have not settled.)`);
