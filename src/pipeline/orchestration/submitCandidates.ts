/**
 * Submit Candidates
 *
 * Submits candidates via the X API in the order they arrive. Non-misinfo
 * candidates below the velocity floor are cut first (recorded, not submitted) —
 * a backstop for candidates that skipped the floor the regular feed already
 * applies at selection. There is no re-sorting here: runPipeline decides the
 * order when it merges the passes (see misinfoReserveRemaining below) — so when
 * the daily cap is hit, the notes cut are the ones the pipeline already ranked
 * last. In dry-run mode, just logs what would be submitted.
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { submitNoteForTweet } from "./submitNoteForTweet";
import type { Post } from "../../api/fetchEligiblePosts";
import type { ProcessTweetResult } from "./processTweet";
import { velocityPerHour, formatVelocity, isAboveVelocityFloor, REGULAR_VELOCITY_FLOOR_PER_HOUR } from "../utils/velocity";

// Prefer the velocity frozen when the post was fetched (regular feed); fall
// back to deriving it for candidates that arrive without one (the pre-passes).
const velocityOf = (c: Candidate) => c.velocity ?? velocityPerHour(c.post);

// ── Misinfo submit-priority reserve ─────────────────────────────────────────
// Misinfo notes (curated topics like Trump election-security) are high-value
// (~10x the views of a standard note) but high-variance: they may rate poorly,
// which dilutes our hit rate and *lowers* the future cap (X's anti-spam lever).
// So they get bounded priority rather than blanket priority — up to
// MISINFO_RESERVE_24H of them per rolling 24h submit AHEAD of the regular notes;
// beyond that they fall in BEHIND, so a heavy topic day cannot consume the whole
// daily cap. Set to 0 to drop misinfo behind the regular notes entirely.
export const MISINFO_RESERVE_24H = 5;
const SUBMISSION_WINDOW_HOURS = 24;

// ── Stale-tweet cutoff ──────────────────────────────────────────────────────
// The velocity floor screens at FETCH time, but a note written on a fresh
// tweet can wait in the candidate queue for cap slots and go out a day later —
// 11.9% of post-floor submissions (Jul 21–Aug 3) were >24h after the tweet,
// and they earn about half a fresh slot: 7.9% ever rated / +3.4% net vs 16.1%
// / +7.3% fresh (historical Mar–Jul: 6.7% rated, +1.5% net, n=310). The knee
// in the lag curve is at 24h — the 12–24h band still carries real helpful
// supply (+5.2% net), so don't cut earlier. Curated-topic notes get 48h:
// slower claim cycles, an 8×-lower velocity floor, and the submit reserve
// exists to protect exactly those notes. Raise the constants to disable.
export const STALE_TWEET_CUTOFF_HOURS = 24;
export const MISINFO_STALE_CUTOFF_HOURS = 48;

/** Tweet age in hours at `nowMs`, from post.created_at, falling back to the
 *  timestamp encoded in the tweet id (snowflake). Null when neither parses. */
export function tweetAgeHours(post: Post, nowMs: number): number | null {
  const fromCreatedAt = post.created_at ? Date.parse(post.created_at) : NaN;
  if (!Number.isNaN(fromCreatedAt)) return (nowMs - fromCreatedAt) / 3_600_000;
  if (/^\d+$/.test(post.id)) {
    const fromSnowflake = Number((BigInt(post.id) >> 22n) + 1288834974657n);
    return (nowMs - fromSnowflake) / 3_600_000;
  }
  return null;
}

/**
 * Split candidates at the stale-tweet cutoff — the at-SUBMIT counterpart of the
 * at-fetch velocity floor, so queue-aged candidates get re-checked every time
 * they come up. Unknown age fails open. Pure — exported for tests.
 */
export function partitionByStaleCutoff(
  candidates: Candidate[],
  nowMs: number = Date.now(),
): { kept: Candidate[]; staleCut: { candidate: Candidate; ageHours: number }[] } {
  const kept: Candidate[] = [];
  const staleCut: { candidate: Candidate; ageHours: number }[] = [];
  for (const c of candidates) {
    const age = tweetAgeHours(c.post, nowMs);
    const cutoff = c.isMisinfo ? MISINFO_STALE_CUTOFF_HOURS : STALE_TWEET_CUTOFF_HOURS;
    if (age !== null && age > cutoff) {
      staleCut.push({ candidate: c, ageHours: age });
    } else {
      kept.push(c);
    }
  }
  return { kept, staleCut };
}

/**
 * How many misinfo notes may still submit ahead of the regular ones in this 24h
 * window. The count covers every misinfo note we submitted, from either
 * discovery route (pre-pass and regular-feed curation). Fail-soft: on a count
 * error reserve nothing — misinfo still submits, just behind the regular notes,
 * which is the safe direction for the daily cap.
 */
export async function misinfoReserveRemaining(logger: SupabaseLogger): Promise<number> {
  try {
    const already = await logger.countRecentMisinfoSubmissions(SUBMISSION_WINDOW_HOURS);
    const remaining = Math.max(0, MISINFO_RESERVE_24H - already);
    console.log(
      `[submit] misinfo reserve: ${already}/${MISINFO_RESERVE_24H} used in the last ` +
        `${SUBMISSION_WINDOW_HOURS}h — ${remaining} note(s) may submit ahead of the regular ones`,
    );
    return remaining;
  } catch (err) {
    console.warn("[submit] misinfo reserve count failed; misinfo submits behind regulars this run:", err);
    return 0;
  }
}

export interface Candidate {
  post: Post;
  tweetResult: ProcessTweetResult;
  botId: string;
  /** Note classification tags. Defaults to ["disputed_claim_as_fact"] (the
   *  regular fact-check pipeline); the Pangram pre-pass sets
   *  ["missing_important_context"] since X has no AI-generated tag. */
  misleadingTags?: string[];
  /** notes.source_url when the candidate has no bot pipelineResult to read it
   *  from (the Pangram pre-pass sets the report link here). */
  sourceUrl?: string;
  /** True for misinfo-monitoring (curated-topic) candidates. Exempts them from
   *  the velocity-floor cut below — the topic has its own, lower floor, applied
   *  at selection. Set in generateMisinfoCandidates. */
  isMisinfo?: boolean;
  /** Velocity frozen when the post was fetched. Absent on candidates that never
   *  went through feed selection — those derive it from the post instead. */
  velocity?: number | null;
}

/**
 * Split candidates at the regular velocity floor — a backstop, since the
 * regular feed now applies the same floor at selection (see collectFastPosts);
 * in practice this only bites candidates that skip selection, i.e. the Pangram
 * pre-pass. Misinfo candidates are never cut here (the topic has its own floor,
 * enforced at both topic selection points — the pre-pass work list and the
 * curation priority fill); unknown velocity fails open. Pure — exported for the
 * offline replay sim (scripts_rob/2026_07_20_velocity_floor_sim) and tests.
 */
export function partitionByVelocityFloor(candidates: Candidate[]): {
  kept: Candidate[];
  floorCut: { candidate: Candidate; velocity: number }[];
} {
  const kept: Candidate[] = [];
  const floorCut: { candidate: Candidate; velocity: number }[] = [];
  for (const c of candidates) {
    const v = velocityOf(c);
    if (v === null && !c.isMisinfo) {
      console.warn(`[submit] velocity unknown for ${c.post.id} (missing metrics) — failing open`);
    }
    if (!c.isMisinfo && v !== null && !isAboveVelocityFloor(v)) {
      floorCut.push({ candidate: c, velocity: v });
    } else {
      kept.push(c);
    }
  }
  return { kept, floorCut };
}

export async function submitCandidates(
  candidates: Candidate[],
  supabaseLogger: SupabaseLogger,
  dryRun: boolean
): Promise<number> {
  const inCI = !!process.env.CI;
  if (inCI) {
    console.log("::endgroup::");
    console.log("::group::Submit results");
  }

  try {
    const { kept: fastEnough, floorCut } = partitionByVelocityFloor(candidates);
    if (floorCut.length) {
      console.log(
        `[submit] velocity floor: cut ${floorCut.length} of ${candidates.length} candidate(s) below ` +
          `${formatVelocity(REGULAR_VELOCITY_FLOOR_PER_HOUR)} — ` +
          floorCut.map((f) => `${f.candidate.post.id} vel=${formatVelocity(f.velocity)}`).join(", "),
      );
    }

    const { kept, staleCut } = partitionByStaleCutoff(fastEnough);
    if (staleCut.length) {
      console.log(
        `[submit] stale cutoff: cut ${staleCut.length} candidate(s) past ` +
          `${STALE_TWEET_CUTOFF_HOURS}h (${MISINFO_STALE_CUTOFF_HOURS}h misinfo) — ` +
          staleCut.map((sc) => `${sc.candidate.post.id} age=${sc.ageHours.toFixed(1)}h`).join(", "),
      );
    }

    // No re-sort: `kept` is already in pipeline order (misinfo, then regular,
    // then pangram — each internally ranked where it was selected).
    const ordered = kept;

    console.log(`[submit] ${ordered.length} candidates to submit (velocity floor applied, pipeline order)`);

    if (dryRun) {
      for (const f of floorCut) {
        console.log(`[submit]   (dry run) FLOOR-CUT vel=${formatVelocity(f.velocity)} | ${f.candidate.post.id}`);
      }
      for (const sc of staleCut) {
        console.log(`[submit]   (dry run) STALE-CUT age=${sc.ageHours.toFixed(1)}h | ${sc.candidate.post.id}`);
      }
      for (const c of ordered) {
        console.log(`[submit]   (dry run) eval=${c.tweetResult.evaluationScore?.toFixed(2) ?? "?"} vel=${formatVelocity(velocityOf(c))}${c.isMisinfo ? " [misinfo]" : ""} | ${c.post.id}`);
      }
      return 0;
    }

    // Record floor-cuts and stale-cuts before submitting: same
    // rejected-with-reason pattern (and cooldown) as the daily-limit drops
    // below. Fail-soft per candidate — a DB hiccup here must not block
    // submitting the keepers.
    for (const f of floorCut) {
      if (f.candidate.tweetResult.pipelineRunId) {
        try {
          await supabaseLogger.completePipelineRun(f.candidate.tweetResult.pipelineRunId, {
            outcome: "rejected",
            outcome_reason: "below_velocity_floor",
            final_stage: "submission",
          });
        } catch {}
      }
    }
    for (const sc of staleCut) {
      if (sc.candidate.tweetResult.pipelineRunId) {
        try {
          await supabaseLogger.completePipelineRun(sc.candidate.tweetResult.pipelineRunId, {
            outcome: "rejected",
            outcome_reason: "stale_at_submit",
            final_stage: "submission",
          });
        } catch {}
      }
    }

    let submitted = 0;
    let expired = 0;
    let errors = 0;
    let limitHit = false;
    let limitSkipped = 0;

    for (const candidate of ordered) {
      const evalStr = candidate.tweetResult.evaluationScore?.toFixed(2) ?? "?";
      const result = await submitNoteForTweet(candidate, supabaseLogger);

      if (result.status === "submitted") {
        submitted++;
        console.log(`[submit] submitted ${candidate.post.id} (eval=${evalStr}, vel=${formatVelocity(velocityOf(candidate))}) → note ${result.noteId}`);
      } else if (result.status === "daily_limit") {
        limitHit = true;
        console.log(`[submit] daily limit reached after ${submitted} submissions`);
        const remaining = ordered.slice(ordered.indexOf(candidate) + 1);
        limitSkipped = remaining.length + 1;
        for (const r of remaining) {
          if (r.tweetResult.pipelineRunId) {
            try {
              await supabaseLogger.completePipelineRun(r.tweetResult.pipelineRunId, {
                outcome: "rejected",
                outcome_reason: "daily_limit_reached",
                final_stage: "submission",
              });
            } catch {}
          }
        }
        break;
      } else if (result.status === "expired") {
        expired++;
        console.log(`[submit] expired ${candidate.post.id} (${result.reason}) — skipping`);
      } else {
        errors++;
        console.log(`[submit] error ${candidate.post.id}: ${result.message} — will not retry`);
      }
    }

    const breakdown = [
      `${submitted} submitted`,
      floorCut.length ? `${floorCut.length} floor-cut` : null,
      staleCut.length ? `${staleCut.length} stale-cut` : null,
      expired ? `${expired} expired` : null,
      errors ? `${errors} errors` : null,
      limitHit ? `${limitSkipped} skipped (daily limit)` : null,
    ].filter(Boolean).join(", ");
    console.log(`[submit] result: ${breakdown}`);

    return submitted;
  } finally {
    if (inCI) console.log("::endgroup::");
  }
}
