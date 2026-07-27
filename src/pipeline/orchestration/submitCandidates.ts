/**
 * Submit Candidates
 *
 * Submits candidates via the X API in the order they arrive. Non-misinfo
 * candidates below the velocity floor are cut first (recorded, not submitted) —
 * a backstop for candidates that skipped the floor the regular feed already
 * applies at selection. There is no re-sorting here: runPipeline hands over the
 * misinfo pre-pass's notes, then the regular pass's (already ranked by feed tier
 * and velocity at selection), then pangram's — so when the daily cap is hit, the
 * notes cut are the ones the pipeline already ranked last. In dry-run mode, just
 * logs what would be submitted.
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { submitNoteForTweet } from "./submitNoteForTweet";
import type { Post } from "../../api/fetchEligiblePosts";
import type { ProcessTweetResult } from "./processTweet";
import { velocityPerHour, formatVelocity, isAboveVelocityFloor, REGULAR_VELOCITY_FLOOR_PER_HOUR } from "../utils/velocity";

// Prefer the velocity frozen when the post was fetched (regular feed); fall
// back to deriving it for candidates that arrive without one (the pre-passes).
const velocityOf = (c: Candidate) => c.velocity ?? velocityPerHour(c.post);

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

    // No re-sort: `kept` is already in pipeline order (misinfo, then regular,
    // then pangram — each internally ranked where it was selected).
    const ordered = kept;

    console.log(`[submit] ${ordered.length} candidates to submit (velocity floor applied, pipeline order)`);

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
