import { SupabaseLogger } from "../api/supabaseClient";
import { submitNoteForTweet, type SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import { validateSignalDraft } from "./drafting";
import type { Conversation } from "./store";

/** Submit the approved snapshot. No model runs here and the final wording is
 * never changed between the approval and the X request. */
export function createSignalSubmitter(logger: SupabaseLogger) {
  return async (conversation: Conversation): Promise<SubmissionResult> => {
    const { draft, approval, inspection } = conversation;
    validateSignalDraft(draft);
    if (!inspection?.post || inspection.post.id !== conversation.tweetId ||
        !approval || approval.version !== draft.version ||
        approval.text !== joinNoteWithSources(draft.text, draft.sources)) {
      return { status: "error", message: "The saved approval does not match this draft. Nothing was submitted." };
    }

    let runId: string;
    try {
      await logger.bulkInsertNewTweets([inspection.post]);
      runId = await logger.createPipelineRun({
        tweet_id: conversation.tweetId,
        bot_name: "signal",
        bot_config: { source: "signal", human_approved: true, draft_version: draft.version },
      });
      await logger.completePipelineRun(runId, {
        outcome: "candidate",
        final_stage: "signal_approved",
        note_text: approval.text,
        source_url: draft.sources.join(" "),
        // Group messages and member identities stay in the local chat database.
        logs: { signal: { draft_version: draft.version, approved_at: new Date(approval.timestamp).toISOString() } },
      });
    } catch {
      return { status: "error", message: "Could not save the approved note to the database. Nothing was submitted." };
    }

    const result = await submitNoteForTweet({
      post: inspection.post,
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
    }, logger, { lane: "signal" });

    // Keep the existing pipeline dashboard useful for rejected manual attempts.
    // A logging failure after X accepted a note must not hide that success.
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
