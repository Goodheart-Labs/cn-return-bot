/** What the review dashboard shows about one passage the Claude note writer's
 *  agents looked at (GOO-507). The server builds it from the prod tables of
 *  migration 129. */
export interface ReviewDraft {
  id: string;
  itemId: string;
  passage: string;
  claim: string;
  kind: "small_mistake" | "missing_context" | "wrong_or_misleading";
  outcome: "note" | "no_note_needed" | "too_hard" | "withdrawn";
  note: string;
  reasoning: string;
  sources: DraftSource[];
  status: "awaiting_approval" | "posted" | "rejected" | "not_a_note";
  noteId: string | null;
  postedAs: PostedAs | null;
  reviewedBy: Reviewer | null;
  reviewedAt: string | null;
  createdAt: string;
  post: { url: string; title: string; creator: string };
  /** The post's paragraph around the passage, as the website shows it. */
  contextParagraph?: string;
  messages: { at: string; actor: Reviewer | "claude"; text: string }[];
  /** Earlier texts of the note, oldest first. */
  earlierVersions: { at: string; note: string; reason: string }[];
}

export interface DraftSource {
  url: string;
  quote: string;
  explanation: string;
}

export type Reviewer = "jim" | "nathan";
export type PostedAs = "ai" | Reviewer;

export interface ReviewState {
  /** Who is using this dashboard, set by the script that started it. */
  reviewer: Reviewer;
  approvalRequired: boolean;
  writer: "pipeline" | "claude";
  drafts: ReviewDraft[];
}
