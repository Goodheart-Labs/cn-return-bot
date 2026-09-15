/**
 * Submit a single note to the X API and record the result in Supabase.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";
import type { Candidate } from "./submitCandidates";
import { bumpWritingLimitFromSuccess } from "./writingLimit";
import { isUncertainSubmissionError, type SubmissionAdmission, type SubmissionClaimOutcome, type SubmissionLane } from "../capacity/submissionReserve";

export type SubmissionResult =
  | { status: "submitted"; noteId: string }
  | { status: "daily_limit" }
  | { status: "expired"; reason: string }
  | Exclude<SubmissionAdmission, { status: "claimed" }>
  | { status: "uncertain"; message: string }
  | { status: "deferred"; message: string }
  | { status: "error"; message: string };

export async function submitNoteForTweet(
  candidate: Candidate,
  logger: SupabaseLogger,
  options: { lane?: SubmissionLane; onSubmitting?: () => boolean | void } = {},
): Promise<SubmissionResult> {
  const { post, tweetResult } = candidate;
  const tweetId = post.id;
  const pipelineRunId = tweetResult.pipelineRunId!;
  const noteText = tweetResult.noteText ?? "";
  const sourceUrl = tweetResult.pipelineResult?.noteResult?.url ?? candidate.sourceUrl ?? "";

  // Every route takes an atomic slot immediately before the X request. A failed
  // RPC never falls back to an unprotected submission, including on Signal.
  let admission: SubmissionAdmission;
  try {
    admission = await logger.claimNoteSubmission(tweetId, options.lane ?? "automatic");
  } catch (err) {
    console.error("[submit] Capacity admission failed; no X request sent:", err);
    return { status: "deferred", message: "Submission capacity unavailable; no X request sent" };
  }
  if (admission.status !== "claimed") return admission;
  const claimId = admission.claimId;
  const finishClaim = async (status: SubmissionClaimOutcome, noteId: string | null = null, reason: string | null = null) => {
    try {
      await logger.finishNoteSubmissionClaim(claimId, status, noteId, reason);
    } catch (err) {
      // The original claim stays in flight if settlement fails, retaining both
      // its capacity and same-tweet retry protection until it is reconciled.
      console.error(`[submit] Failed to settle claim ${claimId}; reconcile before retrying:`, err);
    }
  };

  try {
    const { submitNote } = await import("../../api/submitNote");
    if (options.onSubmitting?.() === false) {
      await finishClaim("rejected", null, "signal_submission_deferred");
      return { status: "deferred", message: "A received message will be handled before this queued submission." };
    }
    const response = await submitNote(tweetId, {
      classification: "misinformed_or_potentially_misleading",
      misleading_tags: candidate.misleadingTags ?? ["disputed_claim_as_fact"],
      text: noteText,
      trustworthy_sources: true,
    });

    const noteId = response?.data?.id;
    if (!noteId) {
      console.error(`[submit] No note ID returned for tweet ${tweetId}:`, JSON.stringify(response?.data));
      await finishClaim("uncertain", null, "No note ID in X response");
      return { status: "uncertain", message: "X returned no note ID; reconcile before retrying" };
    }

    // Persist acceptance before the notes row. The claim then accounts for this
    // submission even when logging fails, and is deduplicated once notes exists.
    await finishClaim("submitted", noteId);

    // The order of these two writes matters. The notes row has to exist before
    // we set pipeline_runs.note_id. Migration 035 added a foreign key from
    // pipeline_runs.note_id to notes.note_id, so the other order would be
    // rejected by the database.
    // Both writes are allowed to fail without failing the whole call. The note
    // was already accepted by X above, and a database hiccup must not hide that.
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

    if (isUncertainSubmissionError(err)) {
      await finishClaim("uncertain", null, errorText);
      console.error(`[submit] Uncertain X outcome for ${tweetId}; will not retry:`, errorText);
      return { status: "uncertain", message: "X submission outcome is uncertain; reconcile before retrying" };
    }

    await finishClaim("rejected", null, errorText);

    if (errorText.toLowerCase().includes("daily limit")) {
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
