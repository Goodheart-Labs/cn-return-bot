/**
 * Every fixed text the bot posts. No model writes these, so a model can never
 * claim that a note was submitted. A model writes only the explanation in a
 * no-note reply and the lead above a revised note.
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

function noteBlock(draft: NoteDraft): string {
  return `${draft.text}\n\n${draft.sources.join("\n")}`;
}

function withLead(lead: string | undefined, text: string): string {
  return lead ? `${lead}\n\n${text}` : text;
}

/** The note went in right away. `lead` is the revision's reply on a revised note. */
export function submittedNoteReply(params: { draft: NoteDraft; noteId: string; lead?: string }): string {
  return withLead(params.lead, `I submitted this Community Note:\n\n${noteBlock(params.draft)}\n\nCommunity Notes contributors now rate it before it can show on the post.\n${noteLink(params.noteId)}`);
}

/** The note has to wait. The bot keeps trying and says what would help. */
export function waitingNoteReply(params: { draft: NoteDraft; reason: WaitReason; lead?: string }): string {
  const why = params.reason === "eligibility"
    ? "X doesn't take notes from me on this post yet. You can help by requesting a Community Note in the post's menu. I'll keep trying for 3 hours and submit it as soon as X allows it."
    : "X's daily limit for AI-written notes is used up right now. I'll keep trying for 3 hours and submit it as soon as there's room.";
  return withLead(params.lead, `I wrote this Community Note:\n\n${noteBlock(params.draft)}\n\n${why} Reply with a correction if something in it is wrong.`);
}

export function noNoteReply(reason: string): string {
  return `${reason}\n\nIf you think I missed something, reply with a source or a correction.`;
}

/** Posted under the bot's own waiting note once it went in. */
export function submittedLaterReply(noteId: string): string {
  return `Submitted. Community Notes contributors now rate it before it can show on the post.\n${noteLink(noteId)}`;
}

/** Posted under an older waiting version when a newer one went in. */
export function otherVersionSubmittedReply(params: { versionPostId: string; noteId: string }): string {
  return `A newer version of this note was submitted instead, because a post can get only one note from me:\nhttps://x.com/i/status/${params.versionPostId}\n\nThe note: ${noteLink(params.noteId)}`;
}

export function alreadySubmittedReply(noteId: string): string {
  return `A note from me is already submitted on this post, so I can't change it anymore:\n${noteLink(noteId)}`;
}

export function gaveUpReply(reason: WaitReason): string {
  return reason === "eligibility"
    ? "I couldn't submit this note within 3 hours, because X still doesn't take notes from me on this post. You can request a Community Note in the post's menu, then tag me under the post again."
    : "I couldn't submit this note within 3 hours, because X's daily limit stayed full. Tag me under the post again to try again.";
}

export const POST_DELETED_REPLY = "The post was deleted, so there is nothing to add a note to.";

export const UNREADABLE_REPLY = "I can't read that post. It may be deleted or from a protected account.";
