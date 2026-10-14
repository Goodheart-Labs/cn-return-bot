import { joinNoteWithSources } from "../pipeline/utils/noteLength";

/**
 * Every fixed text the bot posts. No model writes these, so a model can never
 * claim that a note was submitted. A model writes only the no-note reply.
 */

export interface NoteDraft {
  /** The note body, without URLs. */
  text: string;
  sources: string[];
}

/** Why a note could not go in yet. */
export type WaitReason = "limit" | "eligibility";

function noteLink(noteId: string): string {
  return `https://x.com/i/communitynotes/${noteId}`;
}

export function submittedNoteReply(draft: NoteDraft, noteId: string): string {
  return `I submitted this Community Note:\n\n${joinNoteWithSources(draft.text, draft.sources)}\n\nCommunity Notes contributors now rate it before it can show on the post.\n${noteLink(noteId)}`;
}

/** The note has to wait. The bot keeps trying and says what would help. */
export function waitingNoteReply(draft: NoteDraft, reason: WaitReason): string {
  const why = reason === "eligibility"
    ? "X doesn't take notes from me on this post yet. You can help by requesting a Community Note in the post's menu. I'll keep trying for 3 hours and submit it as soon as X allows it."
    : "X's daily limit for AI-written notes is used up right now. I'll keep trying for 3 hours and submit it as soon as there's room.";
  return `I wrote this Community Note:\n\n${joinNoteWithSources(draft.text, draft.sources)}\n\n${why}`;
}

/** Posted under the bot's own waiting note once it went in. */
export function submittedLaterReply(noteId: string): string {
  return `Submitted. Community Notes contributors now rate it before it can show on the post.\n${noteLink(noteId)}`;
}

export function alreadySubmittedReply(noteId: string): string {
  return `A note from me is already submitted on this post:\n${noteLink(noteId)}`;
}

/** A second tag on a post the bot already answered. */
export function earlierAnswerReply(answerTweetId: string): string {
  return `I already answered about this post here:\nhttps://x.com/i/status/${answerTweetId}`;
}

export function gaveUpReply(reason: WaitReason): string {
  return reason === "eligibility"
    ? "I couldn't submit this note within 3 hours, because X still doesn't take notes from me on this post. You can request a Community Note in the post's menu, then tag me under the post again."
    : "I couldn't submit this note within 3 hours, because X's daily limit stayed full. Tag me under the post again to try again.";
}

export const POST_DELETED_REPLY = "The post was deleted, so there is nothing to add a note to.";

export const UNREADABLE_REPLY = "I can't read that post. It may be deleted or from a protected account.";
