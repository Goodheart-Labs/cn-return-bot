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
}

export async function submitCandidates(
  candidates: Candidate[],
  supabaseLogger: SupabaseLogger,
  dryRun: boolean
): Promise<number> {
  candidates.sort((a, b) => (b.tweetResult.evaluationScore ?? -Infinity) - (a.tweetResult.evaluationScore ?? -Infinity));

  console.log(`[submit] ${candidates.length} candidates to submit (sorted by eval score)`);

  if (dryRun) {
    for (const c of candidates) {
      console.log(`[submit]   (dry run) eval=${c.tweetResult.evaluationScore?.toFixed(2) ?? "?"} | ${c.post.id}`);
    }
    return 0;
  }

  let submitted = 0;
  for (const candidate of candidates) {
    const result = await submitNoteForTweet(candidate, supabaseLogger);

    if (result.status === "submitted") {
      submitted++;
    } else if (result.status === "daily_limit") {
      console.log(`[submit] Daily limit reached after ${submitted} submissions`);
      const remaining = candidates.slice(candidates.indexOf(candidate) + 1);
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
      console.log(`[submit] Tweet ${candidate.post.id} ${result.reason} — skipping`);
    } else {
      console.log(`[submit] Error submitting ${candidate.post.id}: ${result.message} — will not retry`);
    }
  }

  return submitted;
}