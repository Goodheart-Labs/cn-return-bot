/**
 * Submit a single note to the X API and record the result in Supabase.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";
import type { Candidate } from "./submitCandidates";
import { bumpWritingLimitFromSuccess, recordDailyLimitHit } from "./writingLimit";

export type SubmissionResult =
  | { status: "submitted"; noteId: string }
  | { status: "daily_limit" }
  | { status: "expired"; reason: string }
  | { status: "error"; message: string };

export async function submitNoteForTweet(
  candidate: Candidate,
  logger: SupabaseLogger
): Promise<SubmissionResult> {
  const { post, tweetResult } = candidate;
  const tweetId = post.id;
  const pipelineRunId = tweetResult.pipelineRunId!;
  const noteText = tweetResult.noteText ?? "";
  const sourceUrl = tweetResult.pipelineResult?.noteResult?.url ?? "";

  try {
    const { submitNote } = await import("../../api/submitNote");
    const response = await submitNote(tweetId, {
      classification: "misinformed_or_potentially_misleading",
      misleading_tags: ["disputed_claim_as_fact"],
      text: noteText,
      trustworthy_sources: true,
    });

    const noteId = response?.data?.id;
    if (!noteId) {
      console.error(`[submit] No note ID returned for tweet ${tweetId}:`, JSON.stringify(response?.data));
      return { status: "error", message: "No note ID in response" };
    }

    // Order matters: insert into notes first, THEN set pipeline_runs.note_id.
    // Migration 035 added an FK on pipeline_runs.note_id → notes.note_id, so
    // the reverse order would fail referential integrity.
    // Both writes are fail-soft — the X submission already succeeded above
    // and we don't want a DB hiccup to mask that.
    try {
      await logger.logNoteSubmission({
        note_id: noteId,
        tweet_id: tweetId,
        note_text: noteText,
        source_url: sourceUrl,
        submitted_at: new Date().toISOString(),
      });
    } catch (logErr) {
      console.error("[submit] Failed to insert notes row:", logErr);
    }

    try {
      await logger.markCandidateSubmitted(pipelineRunId, noteId);
    } catch (logErr) {
      console.error("[submit] Failed to mark candidate submitted:", logErr);
    }

    try {
      await bumpWritingLimitFromSuccess(logger);
    } catch (limitErr) {
      console.warn("[submit] Failed to bump writing_limit after success:", limitErr);
    }

    return { status: "submitted", noteId };
  } catch (err: any) {
    const errorData = err.response?.data;
    const errorText = errorData
      ? JSON.stringify(errorData).slice(0, 500)
      : (err.message || String(err)).slice(0, 500);

    if (errorText.includes("daily limit")) {
      try {
        await recordDailyLimitHit(logger);
      } catch (stateErr) {
        console.warn("[submit] Failed to record limit hit state:", stateErr);
      }
      return { status: "daily_limit" };
    }

    const statusCode = err.response?.status;
    const isIneligible = errorText.includes("ineligible");
    if (statusCode === 404 || isIneligible) {
      const reason = statusCode === 404 ? "tweet_deleted" : "ineligible";
      try {
        await logger.markCandidateExpired(pipelineRunId, reason);
      } catch (logErr) {
        console.warn("[submit] Failed to mark candidate as expired:", logErr);
      }
      return { status: "expired", reason };
    }

    console.error(`[submit] Error submitting for tweet ${tweetId} (${statusCode ?? "no status"}):`, errorData || err);
    try {
      await logger.completePipelineRun(pipelineRunId, {
        outcome: "rejected",
        outcome_reason: "submit_error",
        final_stage: "submission",
        error_message: errorText.slice(0, 500),
      });
    } catch (logErr) {
      console.warn("[submit] Failed to record submit error:", logErr);
    }
    return { status: "error", message: errorText.slice(0, 200) };
  }
}
