/**
 * Submit a single note to the X API and record the result in Supabase.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";
import type { Candidate } from "./submitCandidates";

const RATE_LIMIT_WINDOW_HOURS = 24;

export type SubmissionResult =
  | { status: "submitted"; noteId: string }
  | { status: "daily_limit" }
  | { status: "expired"; reason: string }
  | { status: "error"; message: string };

export async function submitNoteForTweet(
  candidate: Candidate,
  logger: SupabaseLogger
): Promise<SubmissionResult> {
  const { post, tweetResult, botId } = candidate;
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

    await logger.markCandidateSubmitted(pipelineRunId, noteId);

    try {
      const botConfig = await logger.getOrCreateBotConfig(botId);
      await logger.logNoteSubmission({
        note_id: noteId,
        tweet_id: tweetId,
        bot_config_id: botConfig.id,
        bot_name: botId,
        note_text: noteText,
        source_url: sourceUrl,
        evaluation_score: tweetResult.evaluationScore,
        commit_sha: process.env.GITHUB_SHA,
      });
    } catch (logErr) {
      console.error("[submit] Failed to log to Supabase:", logErr);
    }

    return { status: "submitted", noteId };
  } catch (err: any) {
    const errorData = err.response?.data;
    const errorText = errorData
      ? JSON.stringify(errorData).slice(0, 500)
      : (err.message || String(err)).slice(0, 500);

    if (errorText.includes("daily limit")) {
      try {
        await logger.setPipelineState("limit_hit_at", new Date().toISOString());
        const recentCount = await logger.countRecentSubmissions(RATE_LIMIT_WINDOW_HOURS);
        await logger.setPipelineState("writing_limit", String(recentCount));
        console.log(`[submit] Daily limit reached. Writing limit updated to ${recentCount}`);
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
