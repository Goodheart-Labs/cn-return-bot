/**
 * Every fixed text the bot posts. No model writes these, so a model can never
 * claim that a note was submitted. A model writes only the explanation in a
 * no-note reply and the lead above a revised draft.
 */

export interface NoteDraft {
  /** The note body, without URLs. */
  text: string;
  sources: string[];
}

const REQUEST_A_NOTE = "You can request a Community Note in the post's menu.";
const REQUEST_THEN_RETRY = `You can request a Community Note in the post's menu, then reply "approve" to try again.`;

function noteLink(noteId: string): string {
  return `https://x.com/i/communitynotes/${noteId}`;
}

function draftBlock(draft: NoteDraft): string {
  return `${draft.text}\n\n${draft.sources.join("\n")}`;
}

/** A draft, with a last line that depends on whether X takes our notes on the
 *  post yet. `lead` is the revision's reply on a revised draft. */
export function draftReply(params: { draft: NoteDraft; eligible: boolean; lead?: string }): string {
  const lead = params.lead ? `${params.lead}\n\n` : "";
  const ending = params.eligible
    ? `Reply "approve" and I'll submit it. Or reply with what to change.`
    : `X doesn't take notes from me on this post yet. ${REQUEST_A_NOTE} Then reply "approve" and I'll submit it as soon as X allows it.`;
  return `${lead}Draft Community Note:\n\n${draftBlock(params.draft)}\n\n${ending}`;
}

export function noNoteReply(reason: string): string {
  return `${reason}\n\nIf you think I missed something, reply with a source or a correction.`;
}

/** The reply to an approval that has to wait, because the daily limit is full
 *  or because X doesn't take our notes on the post yet. */
export function queuedReply(eligible: boolean): string {
  return eligible
    ? "Approved. X's daily limit for AI-written notes is used up right now, so the note is queued. I'll reply here once it's submitted."
    : `Approved. X doesn't take notes from me on this post yet, so the note is waiting. You can help by requesting a Community Note in the post's menu. I'll reply here once it's submitted.`;
}

/** The improved version after an improve-and-approve, when it has to wait. */
export function improvedQueuedReply(params: { lead: string; draft: NoteDraft; eligible: boolean }): string {
  return `${params.lead}\n\nI made the change. This version is approved:\n\n${draftBlock(params.draft)}\n\n${queuedReply(params.eligible)}`;
}

export function submittedReply(noteId: string): string {
  return `Submitted. Community Notes contributors now rate it before it can show on the post.\n${noteLink(noteId)}`;
}

export function improvedAndSubmittedReply(params: { lead: string; draft: NoteDraft; noteId: string }): string {
  return `${params.lead}\n\nI made the change and submitted this version:\n\n${draftBlock(params.draft)}\n\n${noteLink(params.noteId)}`;
}

export function otherDraftSubmittedReply(params: { draftPostId: string; noteId: string }): string {
  return `Someone approved a different draft on this post, and that one was submitted, because a post can get only one note from me. This is the draft that went in:\nhttps://x.com/i/status/${params.draftPostId}\n\nThe note: ${noteLink(params.noteId)}`;
}

export function alreadySubmittedReply(noteId: string): string {
  return `A note from me is already submitted on this post:\n${noteLink(noteId)}`;
}

export const NOT_ON_PATH_REPLY = "Only the person who asked for this note, and people whose suggestions shaped it, can approve it. You can suggest a change, or tag me under the post to start your own.";

export function gaveUpReply(eligible: boolean): string {
  return eligible
    ? `I couldn't submit this note within 3 hours, because X's daily limit stayed full. Reply "approve" to try again.`
    : `I couldn't submit this note within 3 hours, because X still doesn't take notes from me on this post. ${REQUEST_THEN_RETRY}`;
}

export function refusedReply(reason: "ineligible" | "deleted"): string {
  return reason === "deleted"
    ? "The post was deleted, so there is nothing to add a note to."
    : `X doesn't take notes from me on this post, so I couldn't submit it. ${REQUEST_THEN_RETRY}`;
}

export const UNREADABLE_REPLY = "I can't read that post. It may be deleted or from a protected account.";
