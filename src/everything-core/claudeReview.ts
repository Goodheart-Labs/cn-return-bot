import type { Database } from "./database.types";
import { supabase } from "./supabase";

/* The admins' review of the Claude note writer's notes (GOO-518). Every call
 * goes through a database function of migration 130, and each of them refuses
 * anyone who is not an admin. The tables behind them are closed to the
 * website's key. */

/** The sidebar's sections, in its order. */
export const REVIEW_SECTIONS = ["unreviewed", "waiting", "approved", "rejected", "no_note"] as const;
export type ReviewSection = (typeof REVIEW_SECTIONS)[number];
export type Reviewer = "jim" | "nathan";

export interface ReviewSummary {
  reviewer: Reviewer;
  writer: "pipeline" | "claude";
  approvalRequired: boolean;
  counts: Record<ReviewSection, number>;
}

export interface ReviewDraftSource {
  url: string;
  quote: string;
  explanation: string;
}

/** One passage the Claude note writer's agents looked at, as the review page
 *  shows it. */
export interface ReviewDraft {
  id: string;
  itemId: string;
  passage: string;
  claim: string;
  kind: "small_mistake" | "missing_context" | "wrong_or_misleading";
  outcome: "note" | "no_note_needed" | "too_hard" | "withdrawn";
  note: string;
  reasoning: string;
  sources: ReviewDraftSource[];
  status: "awaiting_approval" | "posted" | "rejected" | "not_a_note";
  /** The live note on the website, while there is one. */
  noteId: string | null;
  postedAs: "ai" | Reviewer | null;
  reviewedBy: Reviewer | null;
  createdAt: string;
  /** The post's paragraph around the passage. */
  contextParagraph: string | null;
  /** The post, and the creator's project on the website. */
  post: { url: string; title: string; creator: string; creatorSlug: string | null };
  messages: { at: string; actor: Reviewer | "claude"; text: string }[];
  /** Why the last reviewer who rejected the note did so. */
  rejectionReason: string | null;
  /** Earlier texts of the note, oldest first. */
  earlierVersions: { at: string; note: string; reason: string }[];
}

/** Where the next page of a section starts: just after this draft. */
export interface ReviewCursor {
  createdAt: string;
  id: string;
}

/** How many drafts one page holds. */
export const REVIEW_PAGE_SIZE = 20;

type ReviewRow = Database["public"]["CompositeTypes"]["everything_claude_review_draft"];

/** The function's columns are all nullable in the generated types, because
 *  Postgres types a composite's fields that way. The drafts table they come
 *  from fills every one that is not nullable here. */
function toReviewDraft(row: ReviewRow): ReviewDraft {
  return {
    id: row.id!,
    itemId: row.item_id!,
    passage: row.passage!,
    claim: row.claim!,
    kind: row.kind as ReviewDraft["kind"],
    outcome: row.outcome as ReviewDraft["outcome"],
    note: row.note!,
    reasoning: row.reasoning!,
    sources: row.sources as unknown as ReviewDraftSource[],
    status: row.status as ReviewDraft["status"],
    noteId: row.note_id,
    postedAs: row.posted_as as ReviewDraft["postedAs"],
    reviewedBy: row.reviewed_by as Reviewer | null,
    createdAt: row.created_at!,
    contextParagraph: row.context_paragraph,
    post: { url: row.post_url!, title: row.post_title ?? row.post_url!, creator: row.creator ?? "", creatorSlug: row.creator_slug },
    messages: row.messages as unknown as ReviewDraft["messages"],
    rejectionReason: row.rejection_reason || null,
    earlierVersions: row.earlier_versions as unknown as ReviewDraft["earlierVersions"],
  };
}

export async function fetchReviewSummary(): Promise<ReviewSummary> {
  const { data, error } = await supabase.rpc("everything_claude_review_summary").single();
  if (error) throw error;
  const { reviewer, writer, approval_required, ...counts } = data;
  return { reviewer: reviewer as Reviewer, writer: writer as ReviewSummary["writer"], approvalRequired: approval_required, counts };
}

/** One page of a section, newest first, starting after `cursor`. */
export async function fetchReviewPage(section: ReviewSection, cursor: ReviewCursor | null): Promise<ReviewDraft[]> {
  const { data, error } = await supabase.rpc("everything_claude_review_page", {
    p_section: section,
    p_before_created_at: cursor?.createdAt,
    p_before_id: cursor?.id,
    p_limit: REVIEW_PAGE_SIZE,
  });
  if (error) throw error;
  return data.map(toReviewDraft);
}

/** A few drafts by id, at most 50, to refresh them without reloading a
 *  section. */
export async function fetchReviewDrafts(ids: string[]): Promise<ReviewDraft[]> {
  const { data, error } = await supabase.rpc("everything_claude_review_drafts", { p_ids: ids });
  if (error) throw error;
  return data.map(toReviewDraft);
}

/** Keeps the note. A note that waited for approval goes up as an AI note.
 *  Returns the live note's id. */
export async function approveDraft(draftId: string): Promise<string> {
  const { data, error } = await supabase.rpc("everything_claude_approve", { p_draft: draftId });
  if (error) throw error;
  return data;
}

/** Turns the note down. A posted note is deleted from the site. */
export async function rejectDraft(draftId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_reject", { p_draft: draftId, p_reason: reason });
  if (error) throw error;
}

/** Replaces the note's text. A posted note goes up again as an AI note or
 *  under the signed-in admin's own account. Returns the new live note's id,
 *  or null when the draft was not posted. */
export async function rewriteDraft(draftId: string, change: { note: string; postedAs?: "ai" | "me"; reason: string }): Promise<string | null> {
  const { data, error } = await supabase.rpc("everything_claude_rewrite", {
    p_draft: draftId,
    p_note: change.note,
    p_reason: change.reason,
    p_posted_as: change.postedAs,
  });
  if (error) throw error;
  return data;
}

/** A chat message to Claude about one draft. Claude answers within minutes. */
export async function sendDraftMessage(draftId: string, text: string): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_message", { p_draft: draftId, p_text: text });
  if (error) throw error;
}

/** Whether Claude's new notes wait for an admin's approval before they go up. */
export async function setApprovalRequired(required: boolean): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_change_settings", { p_approval_required: required });
  if (error) throw error;
}
