import { SupabaseLogger } from "../api/supabaseClient";
import { submitNoteForTweet, type SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import { validateSignalDraft } from "./drafting";
import type { Conversation } from "./store";

interface SubmissionCallbacks {
  onPrepared?(runId: string): void;
  onSubmitting(): boolean | void;
}

function approvedNote(conversation: Conversation) {
  const { draft, approval } = conversation;
  const post = conversation.inspection?.post;
  validateSignalDraft(draft);
  if (!post || post.id !== conversation.tweetId || !approval || approval.version !== draft.version
      || approval.text !== joinNoteWithSources(draft.text, draft.sources)) {
    throw new Error("The saved approval does not match this draft.");
  }
  return { draft, approval, post };
}

export function createSignalRegistrar(logger: SupabaseLogger) {
  return async (conversation: Conversation): Promise<SubmissionResult | null> => {
    try { approvedNote(conversation); }
    catch { return { status: "error", message: "The saved approval does not match a valid draft. Nothing was submitted." }; }
    try { return await logger.queueSignalSubmission(conversation.tweetId); }
    catch { return { status: "deferred", message: "Submission capacity is unavailable. The approved note will retry." }; }
  };
}

/** Retries use the saved approval; no model runs or edits the note here. */
export function createSignalSubmitter(logger: SupabaseLogger) {
  const register = createSignalRegistrar(logger);
  return async (conversation: Conversation, callbacks?: SubmissionCallbacks): Promise<SubmissionResult> => {
    const existing = await register(conversation);
    if (existing) return existing;
    const { draft, approval, post } = approvedNote(conversation);
    try {
      const capacity = await logger.getNoteSubmissionCapacity();
      if (!capacity.canSubmit) {
        return { status: "capacity_reserved", reason: capacity.probe ? "probe_in_flight" : "capacity_exhausted", capacity };
      }
    } catch {
      return { status: "deferred", message: "Submission capacity is unavailable. The approved note will retry." };
    }

    let runId = conversation.submissionRunId;
    try {
      if (!runId) {
        await logger.bulkInsertNewTweets([post]);
        runId = await logger.createPipelineRun({
          tweet_id: conversation.tweetId,
          bot_name: "signal",
          bot_config: { source: "signal", human_approved: true, draft_version: draft.version },
        });
        callbacks?.onPrepared?.(runId);
      }
      await logger.completePipelineRun(runId, {
        outcome: "candidate",
        final_stage: "signal_approved",
        note_text: approval.text,
        source_url: draft.sources.join(" "),
        logs: { signal: { draft_version: draft.version, approved_at: new Date(approval.timestamp).toISOString() } },
      });
    } catch {
      return { status: "deferred", message: "Could not save the approved note to the database. It will retry; nothing was submitted." };
    }

    const result = await submitNoteForTweet({
      post,
      botId: "signal",
      sourceUrl: draft.sources.join(" "),
      tweetResult: {
        pipelineResult: null,
        outcome: "candidate",
        finalStage: "signal_approved",
        noteText: approval.text,
        pipelineRunId: runId,
        scores: [],
      },
    }, logger, { lane: "signal", ...(callbacks ? { onSubmitting: callbacks.onSubmitting } : {}) });

    if (result.status === "daily_limit" || result.status === "capacity_reserved" || result.status === "deferred") return result;
    try { await logger.cancelSignalSubmission(conversation.tweetId); }
    catch (error) { console.warn("[signal] Could not clear completed queue entry:", error); }

    if (result.status !== "submitted") {
      try {
        await logger.completePipelineRun(runId, {
          outcome: "rejected",
          outcome_reason: `signal_${result.status}`,
          final_stage: "submission",
        });
      } catch (error) {
        console.warn("[signal] Could not record submission outcome:", error);
      }
    }
    return result;
  };
}
