/** One candidate note that a note-finding agent wrote (GOO-504). The shape is
 *  set by src/scripts_jim/2026_10_21_claude_note_finder/agentBrief.md. */
export interface Draft {
  /** The draft's file name, added by the server. */
  file: string;
  postDir: string;
  itemId: string;
  postUrl: string;
  postTitle: string;
  creator: string;
  passage: string;
  claim: string;
  kind: "small_mistake" | "missing_context" | "wrong_or_misleading";
  outcome: "note" | "no_note_needed" | "too_hard";
  note: string;
  reasoning: string;
  sources: DraftSource[];
  verificationRounds: number;
  review?: DraftReview;
  /** Jim's comments on the note, oldest first, each with Claude's answer once
   *  Claude has worked on it. */
  feedback?: DraftFeedback[];
  /** Every earlier version of the note, oldest first. */
  revisions?: DraftRevision[];
  /** The post's paragraph around the passage, added by the server. */
  contextParagraph?: string;
}

export interface DraftSource {
  url: string;
  quote: string;
  explanation: string;
}

export interface DraftReview {
  decision: "accepted" | "rejected";
  at: string;
  reason?: string;
  /** The prod note an accepted draft became. */
  noteId?: string;
}

export interface DraftFeedback {
  at: string;
  comment: string;
  /** The note text Jim was looking at when he wrote the comment. */
  noteAtTheTime: string;
  answer?: { at: string; reply: string };
}

export interface DraftRevision {
  at: string;
  previousNote: string;
  previousSources: DraftSource[];
  /** Why the note changed, usually the comment it answers. */
  reason: string;
}

/** One line of the review log, which keeps every decision and change on every
 *  draft in the order it happened. */
export type ReviewEvent = { at: string; file: string; note: string } & (
  | { type: "accepted"; noteId: string }
  | { type: "rejected"; reason?: string }
  | { type: "feedback"; comment: string }
  | { type: "revised"; previousNote: string; reply: string }
  /** Claude undid an accept on Jim's request and removed the note from prod. */
  | { type: "reverted"; noteId: string }
);
