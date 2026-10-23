/**
 * Submits a note that a person approved, for the Signal bot and the X tag bot.
 *
 * Approved notes wait in the shared approved-notes queue (the table is still
 * called signal_submission_queue), which gives them priority over the automatic
 * pipeline. No model runs here. The note goes in exactly as it was approved.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import type { SubmissionLane } from "../capacity/submissionReserve";
import { joinNoteWithSources } from "../utils/noteLength";
import { submitNoteForTweet, type SubmissionResult } from "./submitNoteForTweet";

export interface ApprovedNote {
  post: Post;
  /** The note body. The sources are appended in this order. */
  text: string;
  sources: string[];
  lane: Exclude<SubmissionLane, "automatic">;
  /** The pipeline_runs bot_name. */
  botName: string;
  /** A run row prepared by an earlier attempt. A retry reuses it. */
  runId?: string;
  botConfig?: Record<string, unknown>;
  logs?: Record<string, unknown>;
}

export interface ApprovedSubmissionCallbacks {
  /** Called once the run row exists, so the caller can keep its id for a retry. */
  onPrepared?(runId: string): void;
  /** Called right before the X request. Returning false defers the submission. */
  onSubmitting?(): boolean | void;
}

const CAPACITY_UNAVAILABLE: SubmissionResult = {
  status: "deferred", message: "Submission capacity is unavailable. The approved note will retry.",
};

/** Puts the post in the approved-notes queue. Returns null when the note now
 *  waits there, or the reason it can't: a note on the post is already
 *  submitted or in flight, or the database is unreachable. */
export async function queueApprovedNote(logger: SupabaseLogger, postId: string): Promise<SubmissionResult | null> {
  try {
    return await logger.queueSignalSubmission(postId);
  } catch {
    return CAPACITY_UNAVAILABLE;
  }
}

export async function submitApprovedNote(
  logger: SupabaseLogger,
  note: ApprovedNote,
  callbacks: ApprovedSubmissionCallbacks = {},
): Promise<SubmissionResult> {
  const queued = await queueApprovedNote(logger, note.post.id);
  if (queued) return queued;
  try {
    const capacity = await logger.getNoteSubmissionCapacity();
    if (!capacity.canSubmit) {
      return { status: "capacity_reserved", reason: capacity.probe ? "probe_in_flight" : "capacity_exhausted", capacity };
    }
  } catch {
    return CAPACITY_UNAVAILABLE;
  }

  const noteText = joinNoteWithSources(note.text, note.sources);
  const sourceUrl = note.sources.join(" ");
  const finalStage = `${note.lane}_approved`;
  let runId = note.runId;
  try {
    if (!runId) {
      await logger.bulkInsertNewTweets([note.post]);
      runId = await logger.createPipelineRun({ tweet_id: note.post.id, bot_name: note.botName, bot_config: note.botConfig });
      callbacks.onPrepared?.(runId);
    }
    await logger.completePipelineRun(runId, {
      outcome: "candidate", final_stage: finalStage, note_text: noteText, source_url: sourceUrl, logs: note.logs,
    });
  } catch {
    return { status: "deferred", message: "Could not save the approved note to the database. It will retry; nothing was submitted." };
  }

  const result = await submitNoteForTweet({
    post: note.post,
    botId: note.botName,
    sourceUrl,
    tweetResult: { pipelineResult: null, outcome: "candidate", finalStage, noteText, pipelineRunId: runId, scores: [] },
  }, logger, { lane: note.lane, ...(callbacks.onSubmitting ? { onSubmitting: callbacks.onSubmitting } : {}) });

  if (result.status === "daily_limit" || result.status === "capacity_reserved" || result.status === "deferred") return result;
  try { await logger.cancelSignalSubmission(note.post.id); }
  catch (error) { console.warn(`[${note.botName}] Could not clear completed queue entry:`, error); }

  if (result.status !== "submitted") {
    try {
      await logger.completePipelineRun(runId, { outcome: "rejected", outcome_reason: `${note.lane}_${result.status}`, final_stage: "submission" });
    } catch (error) {
      console.warn(`[${note.botName}] Could not record submission outcome:`, error);
    }
  }
  return result;
}
