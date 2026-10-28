import type { Database, Json } from "./database.types";
import type { QueryRequest } from "./fieldQuery";
import { supabase } from "./supabase";
import type { XMark } from "./xMarks";

/* The admins' review of the Claude note writer's notes (GOO-518). Every call
 * goes through a database function, and each of them refuses anyone who is
 * not an admin. The tables behind them are closed to the website's key.
 *
 * Since migration 143 (GOO-563) Jim's or Nathan's vote on a note is its
 * review: Helpful approves it and Not helpful disapproves it, wherever the
 * vote is cast. Somewhat helpful decides nothing (migration 150), and when
 * they disagree the note counts as not reviewed (migration 151). A trigger
 * on the votes table records it.
 *
 * Since migration 153 (GOO-623) the page filters and sorts by any field of a
 * draft's field row. The page sends a QueryRequest, and the database runs it. */

export type Reviewer = "jim" | "nathan";

/** A vote of Jim or Nathan: 1 Helpful, 0 Somewhat helpful, -1 Not helpful. */
export type ReviewVote = 1 | 0 | -1;

export interface ReviewSummary {
  reviewer: Reviewer;
  writer: "pipeline" | "claude";
  /** How many drafts pass the filters, and when the newest of them was
   *  written. */
  matching: number;
  newest: string | null;
}

export interface ReviewDraftSource {
  url: string;
  quote: string;
  explanation: string;
}

/** One value of a choice field, and how many drafts it would show. */
export interface FacetValue {
  value: string;
  label: string | null;
  drafts: number;
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
  /** Whether the note is on the site. A posting note was saved but its post
   *  has not finished, or failed. A removed note was deleted from the site,
   *  or rejected with the old buttons. */
  status: "posting" | "posted" | "removed" | "not_a_note";
  /** The review, from Jim's or Nathan's last vote. */
  verdict: "approved" | "disapproved" | null;
  /** The live note on the website, while there is one. */
  noteId: string | null;
  postedAs: "ai" | Reviewer | null;
  reviewedBy: Reviewer | null;
  createdAt: string;
  /** The post's paragraph around the passage. */
  contextParagraph: string | null;
  /** The post, and the creator's project on the website. */
  post: { url: string; title: string; creator: string; creatorSlug: string | null };
  /** How many devices outside the team were shown the post's notes. */
  views: number;
  messages: { at: string; actor: Reviewer | "claude"; text: string }[];
  /** Claude's proposed improvement of the note, from a reviewer's chat. */
  proposal: { note: string; sources: ReviewDraftSource[] } | null;
  /** The note judge's answer for the note's current text. */
  judge: { pHelpful: number; pImpactful: number; reasoning: string } | null;
  onLeaderboard: boolean;
  /** Whether the note was posted on X or the admins decided not to post it. */
  xMark: XMark | null;
  fewShot: boolean;
  /** Jim's and Nathan's votes on the live note, the oldest first. */
  reviewerVotes: { reviewer: Reviewer; vote: ReviewVote }[];
  /** Whether the reviewer reading the page skipped the draft. */
  skipped: boolean;
  /** Jim's and Nathan's shared note on why the note is good or bad, and who
   *  changed it last. */
  reviewNote: { text: string; by: Reviewer; at: string } | null;
  /** Earlier texts of the note, oldest first. */
  earlierVersions: { at: string; note: string; reason: string }[];
  /** Every field of the draft's field row, by field id. */
  fields: Record<string, unknown>;
  /** Where the draft sits in the order of the page it came from. */
  sortKey: number[] | null;
}

/** Where the next page starts: just after this draft. */
export interface ReviewCursor {
  key: number[];
  id: string;
}

/** How many drafts one page holds. */
export const REVIEW_PAGE_SIZE = 20;

type ReviewRow = Database["public"]["CompositeTypes"]["everything_review_draft"];

/** The function's columns are all nullable in the generated types, because
 *  Postgres types a composite's fields that way. The drafts table they come
 *  from fills every one that is not nullable here. */
function toReviewDraft(row: ReviewRow): ReviewDraft {
  const fields = row.fields as Record<string, unknown>;
  const pHelpful = fields.p_helpful as number | null;
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
    verdict: row.verdict as ReviewDraft["verdict"],
    noteId: row.note_id,
    postedAs: row.posted_as as ReviewDraft["postedAs"],
    reviewedBy: row.reviewed_by as Reviewer | null,
    createdAt: row.created_at!,
    contextParagraph: row.context_paragraph,
    post: { url: row.post_url!, title: row.post_title ?? row.post_url!, creator: row.creator ?? "", creatorSlug: row.creator_slug },
    views: fields.views as number,
    messages: row.messages as unknown as ReviewDraft["messages"],
    proposal: row.proposed_note ? { note: row.proposed_note, sources: (row.proposed_sources ?? row.sources) as unknown as ReviewDraftSource[] } : null,
    judge: pHelpful === null ? null : { pHelpful, pImpactful: fields.p_impactful as number, reasoning: row.judge_reasoning! },
    onLeaderboard: fields.leaderboard as boolean,
    xMark: fields.on_x === "not_posted" ? null : (fields.on_x as XMark),
    fewShot: fields.few_shot as boolean,
    reviewerVotes: row.reviewer_votes as unknown as ReviewDraft["reviewerVotes"],
    skipped: fields.skipped as boolean,
    reviewNote: row.review_note ? { text: row.review_note, by: row.review_note_by as Reviewer, at: row.review_note_at! } : null,
    earlierVersions: row.earlier_versions as unknown as ReviewDraft["earlierVersions"],
    fields,
    sortKey: row.sort_key,
  };
}

/** The request as the database functions take it. */
const requestArg = (request: QueryRequest) => request as unknown as Json;

export async function fetchReviewSummary(request: QueryRequest): Promise<ReviewSummary> {
  const { data, error } = await supabase.rpc("everything_review_summary", { p_request: requestArg(request) }).single();
  if (error) throw error;
  return { reviewer: data.reviewer as Reviewer, writer: data.writer as ReviewSummary["writer"], matching: data.matching, newest: data.newest };
}

/** One page of the drafts that pass the request's filters, in its order,
 *  starting after `cursor`. */
export async function fetchReviewPage(request: QueryRequest, cursor: ReviewCursor | null): Promise<ReviewDraft[]> {
  const { data, error } = await supabase.rpc("everything_review_page", {
    p_request: requestArg(request),
    p_after_key: cursor?.key,
    p_after_id: cursor?.id,
    p_limit: REVIEW_PAGE_SIZE,
  });
  if (error) throw error;
  return data.map(toReviewDraft);
}

/** How many drafts each value of these choice fields would show under the
 *  request's other filters, by field. A field with a `labelColumn` gets each
 *  value's display name from that column. */
export async function fetchReviewFacets(request: QueryRequest, facets: { column: string; labelColumn?: string }[]): Promise<Record<string, FacetValue[]>> {
  const { data, error } = await supabase.rpc("everything_review_facets", {
    p_request: requestArg(request),
    p_facets: facets.map((f) => ({ column: f.column, ...(f.labelColumn ? { label_column: f.labelColumn } : {}) })),
  });
  if (error) throw error;
  const byField: Record<string, FacetValue[]> = {};
  for (const row of data) (byField[row.field] ??= []).push({ value: row.value, label: row.label, drafts: row.drafts });
  return byField;
}

/** A few drafts by id, at most 50, to refresh them without reloading a
 *  section. */
export async function fetchReviewDrafts(ids: string[]): Promise<ReviewDraft[]> {
  const { data, error } = await supabase.rpc("everything_review_drafts", { p_ids: ids });
  if (error) throw error;
  return data.map(toReviewDraft);
}

/** Deletes the note from the site. It then counts as disapproved. */
export async function deleteDraftNote(draftId: string): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_delete_note", { p_draft: draftId });
  if (error) throw error;
}

/** Marks the draft as skipped by the reviewer reading the page, or takes the
 *  mark off. */
export async function skipDraft(draftId: string, skip: boolean): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_skip", { p_draft: draftId, p_skip: skip });
  if (error) throw error;
}

/** Replaces the shared review note. An empty text clears it. */
export async function setReviewNote(draftId: string, text: string): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_set_review_note", { p_draft: draftId, p_text: text });
  if (error) throw error;
}

/** Replaces the note's text, and with Claude's proposal its sources too. A
 *  posted note goes up again as an AI note or under the signed-in admin's own
 *  account. Returns the new live note's id, or null when the draft was not
 *  posted. */
export async function rewriteDraft(
  draftId: string,
  change: { note: string; sources?: ReviewDraftSource[]; postedAs?: "ai" | "me"; reason: string },
): Promise<string | null> {
  const { data, error } = await supabase.rpc("everything_claude_rewrite", {
    p_draft: draftId,
    p_note: change.note,
    p_sources: change.sources as unknown as Json,
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

/** Marks a draft as an example to show the note writer later, or takes the
 *  mark off. */
export async function setFewShotExample(draftId: string, on: boolean): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_set_few_shot", { p_draft: draftId, p_on: on });
  if (error) throw error;
}
