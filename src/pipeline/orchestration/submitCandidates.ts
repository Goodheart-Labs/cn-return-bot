/**
 * Submit Candidates
 *
 * Submits candidates via the X API in priority order. Non-misinfo candidates
 * below the velocity floor are cut first (recorded, not submitted) — a backstop
 * for candidates that skipped the floor the regular feed already applies at
 * selection. Base order is eval score descending. On top of that, a bounded
 * number of the *fastest* misinfo (curated-topic, e.g. Trump) notes are pushed
 * to the very front — see the reserve below. In dry-run mode, just logs what
 * would be submitted.
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { submitNoteForTweet } from "./submitNoteForTweet";
import type { Post } from "../../api/fetchEligiblePosts";
import type { ProcessTweetResult } from "./processTweet";
import { velocityPerHour, formatVelocity, isAboveVelocityFloor, REGULAR_VELOCITY_FLOOR_PER_HOUR } from "../utils/velocity";

// ── Misinfo submit-priority reserve ─────────────────────────────────────────
// Misinfo notes (curated topics like Trump election-security) run an *advisory*
// eval gate — they become candidates even when X scores them low. But the submit
// order is eval-descending, so on a saturated day (submissions already at the
// daily cap) a low-eval misinfo note sorts to the bottom and gets cut. This
// reserve pushes up to MISINFO_RESERVE_24H of the fastest misinfo notes to the
// front so they get a slot despite saturation.
//
// Bounded over a rolling 24h window: misinfo is high-value (≈10× the views of
// a standard note) but high-variance (may rate poorly → dilutes hit rate →
// *lowers* the future cap, X's anti-spam lever). EXPERIMENT (through
// 2026-07-24, agreed with maintainers): raised from the long-run value of 2 to
// 5 — roughly a third of recent daily submissions — paired with the velocity
// floors so the boosted notes are the fastest on offer. Revert to 2 at the
// week-end review unless the topic notes are getting rated. Set
// MISINFO_RESERVE_24H = 0 to disable the reserve entirely.
const MISINFO_RESERVE_24H = 5;
// Only misinfo notes with eval ≥ this floor ride the reserve. Default -Infinity
// (no floor) for v1: a floor at/above the gate threshold (0) would exclude
// exactly the low-eval misinfo notes the advisory gate is meant to rescue —
// self-defeating until we've observed how X actually scores Trump notes. The
// 24h bound above is the real safety; raise this knob once we have that data.
const MISINFO_RESERVE_EVAL_FLOOR = -Infinity;
const SUBMISSION_WINDOW_HOURS = 24;

const evalOf = (c: Candidate) => c.tweetResult.evaluationScore ?? -Infinity;
const byEvalDesc = (a: Candidate, b: Candidate) => evalOf(b) - evalOf(a);
// Prefer the velocity frozen when the post was fetched (regular feed); fall
// back to deriving it for candidates that arrive without one (the pre-passes).
const velocityOf = (c: Candidate) => c.velocity ?? velocityPerHour(c.post);
// Unknown velocity sorts LAST: the floor fails open for it, but being
// uncuttable shouldn't also mean winning a scarce reserve slot.
const byVelocityDesc = (a: Candidate, b: Candidate) =>
  (velocityOf(b) ?? -Infinity) - (velocityOf(a) ?? -Infinity);

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
  /** True for misinfo-monitoring (curated-topic) candidates. Drives the bounded
   *  submit-priority reserve above. Set in generateMisinfoCandidates. */
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

/**
 * Pure ordering core: eval descending, with up to `reserveRemaining` of the
 * FASTEST misinfo notes boosted to the front. The boost ranks by velocity, not
 * eval: X's eval score systematically penalizes political notes, so it is the
 * wrong signal for picking which misinfo notes ride the reserve; the regular
 * (non-boosted) order stays eval-descending. Exported for the offline sim and
 * tests.
 */
export function orderWithReserve(candidates: Candidate[], reserveRemaining: number): Candidate[] {
  if (reserveRemaining <= 0) return [...candidates].sort(byEvalDesc);

  const boosted = candidates
    .filter((c) => c.isMisinfo && evalOf(c) >= MISINFO_RESERVE_EVAL_FLOOR)
    .sort(byVelocityDesc)
    .slice(0, reserveRemaining);
  if (boosted.length === 0) return [...candidates].sort(byEvalDesc);

  const boostedSet = new Set(boosted);
  const rest = candidates.filter((c) => !boostedSet.has(c)).sort(byEvalDesc);
  console.log(
    `[submit] misinfo reserve: boosted ${boosted.length} note(s) to front (velocity-ranked) — ` +
      boosted.map((c) => `vel=${formatVelocity(velocityOf(c))} eval=${evalOf(c).toFixed(2)}`).join(", "),
  );
  return [...boosted, ...rest];
}

/**
 * Order candidates for submission (see orderWithReserve). Fail-soft — any
 * error reading the 24h misinfo count falls back to plain eval-sort (no boost).
 */
async function orderForSubmission(
  candidates: Candidate[],
  supabaseLogger: SupabaseLogger,
): Promise<Candidate[]> {
  if (MISINFO_RESERVE_24H <= 0) return [...candidates].sort(byEvalDesc);

  let reserveRemaining = 0;
  try {
    const already = await supabaseLogger.countRecentMisinfoSubmissions(SUBMISSION_WINDOW_HOURS);
    reserveRemaining = Math.max(0, MISINFO_RESERVE_24H - already);
    console.log(`[submit] misinfo reserve: ${already}/${MISINFO_RESERVE_24H} used in the last ${SUBMISSION_WINDOW_HOURS}h`);
  } catch (err) {
    console.warn("[submit] misinfo reserve count failed; no boost this run:", err);
    return [...candidates].sort(byEvalDesc);
  }
  return orderWithReserve(candidates, reserveRemaining);
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
    const { kept, floorCut } = partitionByVelocityFloor(candidates);
    if (floorCut.length) {
      console.log(
        `[submit] velocity floor: cut ${floorCut.length} of ${candidates.length} candidate(s) below ` +
          `${formatVelocity(REGULAR_VELOCITY_FLOOR_PER_HOUR)} — ` +
          floorCut.map((f) => `${f.candidate.post.id} vel=${formatVelocity(f.velocity)}`).join(", "),
      );
    }

    const ordered = await orderForSubmission(kept, supabaseLogger);

    console.log(`[submit] ${ordered.length} candidates to submit (velocity floor applied, eval-sorted, misinfo reserve velocity-ranked)`);

    if (dryRun) {
      for (const f of floorCut) {
        console.log(`[submit]   (dry run) FLOOR-CUT vel=${formatVelocity(f.velocity)} | ${f.candidate.post.id}`);
      }
      for (const c of ordered) {
        console.log(`[submit]   (dry run) eval=${c.tweetResult.evaluationScore?.toFixed(2) ?? "?"} vel=${formatVelocity(velocityOf(c))}${c.isMisinfo ? " [misinfo]" : ""} | ${c.post.id}`);
      }
      return 0;
    }

    // Record floor-cuts before submitting: same rejected-with-reason pattern
    // (and cooldown) as the daily-limit drops below. Fail-soft per candidate —
    // a DB hiccup here must not block submitting the keepers.
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
