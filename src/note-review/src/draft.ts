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
  sources: { url: string; quote: string; explanation: string }[];
  verificationRounds: number;
  review?: DraftReview;
}

export interface DraftReview {
  decision: "accepted" | "rejected";
  at: string;
  reason?: string;
  /** The prod note an accepted draft became. */
  noteId?: string;
}
