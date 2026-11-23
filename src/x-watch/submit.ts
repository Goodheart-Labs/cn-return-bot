/**
 * Submits one of cn-x-watch's queued notes to X (GOO-851).
 *
 * The first account's X run submits through the claims of migration 100,
 * because its runs, the Signal bot and the probe workflow can submit at the
 * same time. cn-x-watch is the only process that submits for its account and
 * submits one note at a time, so it needs no claim. Its writing limit lives in
 * room.ts.
 */

import { describeXError } from "../api/describeXError";
import { submitNote } from "../api/submitNote";
import type { SupabaseLogger } from "../api/supabaseClient";
import { isUncertainSubmissionError } from "../pipeline/capacity/submissionReserve";
import { markTestNoteSubmitted, type QueuedNote } from "./db";

/** "closed": the note's run is settled, whether X took the note or not.
 *  "daily_limit": X refused it for the account's daily limit, and the note
 *  stays queued for a later slot. */
export type SubmitOutcome = "submitted" | "daily_limit" | "closed";

/** How the Claude note writer's notes are filed, as in submitNoteForTweet. */
const NOTE_FILING = { classification: "misinformed_or_potentially_misleading", misleading_tags: ["disputed_claim_as_fact"], trustworthy_sources: true };

export async function submitQueuedNote(note: QueuedNote, testMode: boolean, logger: SupabaseLogger): Promise<SubmitOutcome> {
  let noteId: string | undefined;
  try {
    const response = await submitNote(note.tweetId, { ...NOTE_FILING, text: note.noteText }, testMode);
    noteId = response?.data?.id;
  } catch (err) {
    return closeRefusedNote(note, err, logger);
  }
  if (testMode) {
    await markTestNoteSubmitted(note.runId);
    console.log(`[x-watch] test note submitted on ${note.tweetId}`);
    return "submitted";
  }
  if (!noteId) {
    await logger.completePipelineRun(note.runId, { outcome: "rejected", outcome_reason: "submit_uncertain", final_stage: "submission", error_message: "X accepted the request but returned no note id" });
    return "closed";
  }
  // The notes row must exist before pipeline_runs.note_id points at it
  // (migration 035).
  await logger.logNoteSubmission({ note_id: noteId, tweet_id: note.tweetId, note_text: note.noteText, source_url: note.sourceUrl, submitted_at: new Date().toISOString() });
  await logger.markCandidateSubmitted(note.runId, noteId);
  console.log(`[x-watch] note ${noteId} submitted on ${note.tweetId}`);
  return "submitted";
}

async function closeRefusedNote(note: QueuedNote, err: unknown, logger: SupabaseLogger): Promise<SubmitOutcome> {
  const errorText = describeXError(err);
  if (errorText.toLowerCase().includes("daily limit")) return "daily_limit";
  const status = (err as { response?: { status?: number } }).response?.status;
  console.warn(`[x-watch] X refused the note on ${note.tweetId}: ${errorText}`);
  if (status === 404 || errorText.includes("ineligible")) {
    await logger.markCandidateExpired(note.runId, status === 404 ? "tweet_deleted" : "ineligible");
    return "closed";
  }
  // A timeout or a server error may still have created the note. It is not
  // sent again, because a second note on the same post would be refused or,
  // worse, accepted twice.
  const reason = isUncertainSubmissionError(err) ? "submit_uncertain" : "submit_error";
  await logger.completePipelineRun(note.runId, { outcome: "rejected", outcome_reason: reason, final_stage: "submission", error_message: errorText.slice(0, 500) });
  return "closed";
}
