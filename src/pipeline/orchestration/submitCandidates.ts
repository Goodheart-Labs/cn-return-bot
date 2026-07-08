/**
 * Submit Candidates
 *
 * Sorts candidates by eval score descending and submits them via X API.
 * In dry-run mode, just logs what would be submitted.
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { submitNoteForTweet } from "./submitNoteForTweet";
import type { Post } from "../../api/fetchEligiblePosts";
import type { ProcessTweetResult } from "./processTweet";

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
    candidates.sort((a, b) => (b.tweetResult.evaluationScore ?? -Infinity) - (a.tweetResult.evaluationScore ?? -Infinity));

    console.log(`[submit] ${candidates.length} candidates to submit (sorted by eval score)`);

    if (dryRun) {
      for (const c of candidates) {
        console.log(`[submit]   (dry run) eval=${c.tweetResult.evaluationScore?.toFixed(2) ?? "?"} | ${c.post.id}`);
      }
      return 0;
    }

    let submitted = 0;
    let expired = 0;
    let errors = 0;
    let limitHit = false;
    let limitSkipped = 0;

    for (const candidate of candidates) {
      const evalStr = candidate.tweetResult.evaluationScore?.toFixed(2) ?? "?";
      const result = await submitNoteForTweet(candidate, supabaseLogger);

      if (result.status === "submitted") {
        submitted++;
        console.log(`[submit] submitted ${candidate.post.id} (eval=${evalStr}) → note ${result.noteId}`);
      } else if (result.status === "daily_limit") {
        limitHit = true;
        console.log(`[submit] daily limit reached after ${submitted} submissions`);
        const remaining = candidates.slice(candidates.indexOf(candidate) + 1);
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