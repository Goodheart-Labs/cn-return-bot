import { SupabaseLogger } from "../api/supabaseClient";
import { queueApprovedNote, submitApprovedNote } from "../pipeline/orchestration/submitApprovedNote";
import type { SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";
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
    return queueApprovedNote(logger, conversation.tweetId);
  };
}

/** Retries use the saved approval; no model runs or edits the note here. */
export function createSignalSubmitter(logger: SupabaseLogger) {
  return async (conversation: Conversation, callbacks?: SubmissionCallbacks): Promise<SubmissionResult> => {
    let approved: ReturnType<typeof approvedNote>;
    try { approved = approvedNote(conversation); }
    catch { return { status: "error", message: "The saved approval does not match a valid draft. Nothing was submitted." }; }
    const { draft, approval, post } = approved;
    return submitApprovedNote(logger, {
      post, text: draft.text, sources: draft.sources, lane: "signal", botName: "signal",
      runId: conversation.submissionRunId,
      botConfig: { source: "signal", human_approved: true, draft_version: draft.version },
      logs: { signal: { draft_version: draft.version, approved_at: new Date(approval.timestamp).toISOString() } },
    }, callbacks);
  };
}
