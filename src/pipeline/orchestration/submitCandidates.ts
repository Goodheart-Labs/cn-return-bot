/**
 * Submit Candidates
 *
 * Submits candidates through the X API in the order they arrive. Candidates that
 * are not misinfo and sit below the velocity floor are cut first. They are
 * recorded as rejected instead of being submitted. That cut is only a backstop,
 * because the regular feed already applies the same floor at selection.
 *
 * Nothing is re-sorted here. runPipeline fixes the order when it merges the
 * passes, and misinfoReserveRemaining below is what shapes that order. So when
 * the daily cap runs out, the notes that get dropped are the ones the pipeline
 * had already ranked last.
 *
 * In dry-run mode nothing is submitted and we only log what would have been.
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { submitNoteForTweet } from "./submitNoteForTweet";
import type { Post } from "../../api/fetchEligiblePosts";
import type { ProcessTweetResult } from "./processTweet";
import { velocityPerHour, formatVelocity, isAboveVelocityFloor, REGULAR_VELOCITY_FLOOR_PER_HOUR } from "../utils/velocity";
import { featuresFromPost } from "../ranking/features";
import { SCORERS } from "../ranking/scorers";

// We prefer the velocity that was frozen when the post was fetched, which is
// what the regular feed does. Candidates from the pre-passes arrive without one,
// so for those we derive the velocity from the post instead.
const velocityOf = (c: Candidate) => c.velocity ?? velocityPerHour(c.post);

// ── Misinfo submit-priority reserve ─────────────────────────────────────────
// Misinfo notes are the ones on curated topics, for example Trump election
// security. They are worth a lot, since they get roughly ten times the views of
// a standard note. They are also risky. When they rate poorly they drag our hit
// rate down, and X responds by lowering our future daily cap. That cap is X's
// anti-spam lever.
// So misinfo notes get bounded priority instead of blanket priority. Up to
// MISINFO_RESERVE_24H of them per rolling 24 hours go out ahead of the regular
// notes. Any beyond that go out behind the regular notes, so a day full of topic
// hits cannot swallow the whole daily cap. Set this to 0 to keep misinfo behind
// the regular notes at all times.
//
// Set to 0 on 2026-08-18. Topic notes had a 0/126 helpful record while holding
// priority, so they now queue behind the regular notes. The pre-pass still
// crawls the XXL feed and its candidates still submit, last.
export const MISINFO_RESERVE_24H = 0;
const SUBMISSION_WINDOW_HOURS = 24;

// ── Stale-tweet cutoff ──────────────────────────────────────────────────────
// The velocity floor screens a post when we fetch it. A note written on a fresh
// tweet can still sit in the candidate queue waiting for a cap slot and only go
// out a day later. Between 21 July and 3 August, 11.9% of the submissions that
// had passed the floor went out more than 24 hours after the tweet. A late
// submission is worth about half a fresh one. 7.9% of them were ever rated and
// their net helpful rate was +3.4%, against 16.1% and +7.3% for fresh ones. The
// longer history from March to July agrees, with 6.7% rated and +1.5% net over
// 310 notes.
// The lag curve bends at 24 hours, which is why the cutoff sits there. The band
// from 12 to 24 hours still supplies real helpful notes at +5.2% net, so we do
// not cut earlier than that.
// Curated-topic notes get 48 hours instead. Their claims move more slowly, their
// velocity floor is far lower, and the submit reserve exists to protect exactly
// those notes. Raise these constants to switch the cutoffs off.
export const STALE_TWEET_CUTOFF_HOURS = 24;
export const MISINFO_STALE_CUTOFF_HOURS = 48;

/** The tweet's age in hours at `nowMs`. It reads post.created_at first. When that
 *  is missing it falls back to the timestamp encoded in the tweet id, which X
 *  calls a snowflake. It returns null when neither of the two parses. */
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
 * Splits the candidates at the stale-tweet cutoff. This is the submit-time
 * counterpart of the velocity floor we apply at fetch time. It means a candidate
 * that aged in the queue is checked again every time it comes up. A candidate
 * whose age we cannot work out is kept. The function is pure and is exported for
 * the tests.
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
 * Returns how many misinfo notes may still go out ahead of the regular ones in
 * this 24 hour window. The count covers every misinfo note we submitted, no
 * matter which route found it. The two routes are the pre-pass and the curation
 * inside the regular feed.
 *
 * When the count itself fails we reserve nothing. Misinfo notes are still
 * submitted, just behind the regular ones. That is the safe direction, because
 * it cannot spend the daily cap on the riskier notes.
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
  /** The note classification tags. The regular fact-check pipeline leaves this
   *  unset and we then send ["disputed_claim_as_fact"]. The Pangram pre-pass sets
   *  ["missing_important_context"], because X has no tag for AI-generated text. */
  misleadingTags?: string[];
  /** The value to store in notes.source_url when the candidate has no bot
   *  pipeline result to read it from. The Pangram pre-pass puts its report link
   *  here. */
  sourceUrl?: string;
  /** True for the misinfo-monitoring candidates, which are the curated-topic
   *  ones. It exempts them from the velocity-floor cut below. The topic path has
   *  its own lower floor and applies it at selection. It is set in
   *  generateMisinfoCandidates. */
  isMisinfo?: boolean;
  /** The velocity frozen when the post was fetched. Candidates that never went
   *  through feed selection have none, and we derive their velocity from the
   *  post instead. */
  velocity?: number | null;
}

/**
 * Splits the candidates at the regular velocity floor. This is only a backstop,
 * because the regular feed already applies the same floor at selection. See
 * collectFastPosts for that. In practice this cut only bites candidates that
 * skipped selection, which today means the Pangram pre-pass.
 *
 * Misinfo candidates are never cut here. The topic path has its own floor and
 * enforces it at both of its selection points, the pre-pass work list and the
 * curation priority fill. A candidate whose velocity we cannot work out is kept.
 *
 * The function is pure. It is exported for the tests and for the offline replay
 * simulation in scripts_rob/2026_07_20_velocity_floor_sim.
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

    // We do not re-sort. `kept` is already in the order runPipeline built: the
    // reserved misinfo notes, then the regular ones, then any misinfo notes past
    // the reserve, then the Pangram ones. Each group was ranked where it was
    // selected.
    const ordered = kept;

    console.log(`[submit] ${ordered.length} candidates to submit (velocity floor applied, pipeline order)`);
    for (const c of ordered) {
      const f = featuresFromPost(c.post, c.velocity, null);
      const scores = Object.values(SCORERS)
        .map((s) => `${s.name}=${s.scoreSubmit(f, c.tweetResult.evaluationScore ?? null).toFixed(2)}`)
        .join(" ");
      console.log(`[submit]   shadow ${c.post.id} ${scores}`);
    }

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

    // The floor cuts and the stale cuts are recorded before anything is
    // submitted. They use the same rejected-with-reason pattern, and so the same
    // cooldown, as the daily-limit drops further down. Each write is allowed to
    // fail on its own, because a database hiccup here must not stop us
    // submitting the candidates we kept.
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
