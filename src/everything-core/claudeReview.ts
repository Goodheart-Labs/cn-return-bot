import type { Database, Json } from "./database.types";
import type { NoteFilters, NoteMinimums } from "./feedPages";
import { supabase } from "./supabase";

/* The admins' review of the Claude note writer's notes (GOO-518). Every call
 * goes through a database function of migrations 130 and 143, and each of
 * them refuses anyone who is not an admin. The tables behind them are closed
 * to the website's key.
 *
 * Since migration 143 (GOO-563) Jim's or Nathan's vote on a note is its
 * review: Helpful or Somewhat helpful approves it, Not helpful disapproves it,
 * wherever the vote is cast. A trigger on the votes table records it. */

/** The sidebar's sections, in its order. Skipped holds the notes the reviewer
 *  reading the page skipped and nobody reviewed yet. */
export const REVIEW_SECTIONS = ["unreviewed", "waiting", "approved", "disapproved", "no_note", "skipped"] as const;
export type ReviewSection = (typeof REVIEW_SECTIONS)[number];
export type Reviewer = "jim" | "nathan";

/** How the crowd rated a live note: rated helpful, only Helpful or Somewhat
 *  helpful votes, or anything else, including no note on the site. The
 *  author's own automatic vote does not count. */
export const CROWD_RATINGS = ["helpful", "upvoted", "other"] as const;
export type CrowdRating = (typeof CROWD_RATINGS)[number];

/** What narrows every section: the crowd ratings it shows, and the All notes
 *  page's filters (migration 144). With `unvotedOnly`, the notes the reviewer
 *  had voted on before `votedBefore` are hidden, so a vote cast while
 *  reviewing never makes its card vanish. */
export interface ReviewFilters extends NoteFilters {
  ratings: CrowdRating[];
  votedBefore: Date;
}

export interface ReviewSummary {
  reviewer: Reviewer;
  writer: "pipeline" | "claude";
  approvalRequired: boolean;
  counts: Record<ReviewSection, number>;
  /** The largest view and vote counts of any note, where the filter sliders end. */
  largest: NoteMinimums;
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
  /** Whether the note is on the site. A removed note was deleted from the
   *  site or turned down while it waited for approval. */
  status: "awaiting_approval" | "posted" | "removed" | "not_a_note";
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
  /** Whether the reviewer reading the page skipped the draft. */
  skipped: boolean;
  /** Reasons of old rejections and explanations given after a vote, oldest
   *  first. */
  explanations: { at: string; actor: Reviewer; text: string }[];
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
    verdict: row.verdict as ReviewDraft["verdict"],
    noteId: row.note_id,
    postedAs: row.posted_as as ReviewDraft["postedAs"],
    reviewedBy: row.reviewed_by as Reviewer | null,
    createdAt: row.created_at!,
    contextParagraph: row.context_paragraph,
    post: { url: row.post_url!, title: row.post_title ?? row.post_url!, creator: row.creator ?? "", creatorSlug: row.creator_slug },
    views: row.views ?? 0,
    messages: row.messages as unknown as ReviewDraft["messages"],
    proposal: row.proposed_note ? { note: row.proposed_note, sources: (row.proposed_sources ?? row.sources) as unknown as ReviewDraftSource[] } : null,
    judge: row.judge_p_helpful === null ? null : { pHelpful: row.judge_p_helpful, pImpactful: row.judge_p_impactful!, reasoning: row.judge_reasoning! },
    onLeaderboard: row.on_leaderboard!,
    skipped: row.skipped!,
    explanations: row.explanations as unknown as ReviewDraft["explanations"],
    earlierVersions: row.earlier_versions as unknown as ReviewDraft["earlierVersions"],
  };
}

/** The filters as the database functions take them. All three crowd ratings
 *  show everything, which the database reads as no rating filter at all. */
const filterArgs = (filters: ReviewFilters) => ({
  p_ratings: filters.ratings.length === CROWD_RATINGS.length ? undefined : filters.ratings,
  p_min_views: filters.views,
  p_min_votes: filters.votes,
  p_min_helpful: filters.helpful,
  p_min_not_helpful: filters.notHelpful,
  p_unvoted_only: filters.unvotedOnly,
  p_voted_before: filters.votedBefore.toISOString(),
});

export async function fetchReviewSummary(filters: ReviewFilters): Promise<ReviewSummary> {
  const { data, error } = await supabase.rpc("everything_claude_review_summary", filterArgs(filters)).single();
  if (error) throw error;
  const { reviewer, writer, approval_required, largest_views, largest_votes, largest_helpful, largest_not_helpful, ...counts } = data;
  return {
    reviewer: reviewer as Reviewer,
    writer: writer as ReviewSummary["writer"],
    approvalRequired: approval_required,
    counts,
    largest: { views: largest_views, votes: largest_votes, helpful: largest_helpful, notHelpful: largest_not_helpful },
  };
}

/** One page of a section, newest first, starting after `cursor`. */
export async function fetchReviewPage(section: ReviewSection, filters: ReviewFilters, cursor: ReviewCursor | null): Promise<ReviewDraft[]> {
  const { data, error } = await supabase.rpc("everything_claude_review_page", {
    p_section: section,
    ...filterArgs(filters),
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

/** A vote on a note that waits for approval. An upvote posts it as an AI note
 *  and returns its id, so the caller casts the vote on it. A Not helpful vote
 *  keeps it off the site and returns null. */
export async function voteOnWaitingDraft(draftId: string, vote: number): Promise<string | null> {
  const { data, error } = await supabase.rpc("everything_claude_vote_waiting", { p_draft: draftId, p_vote: vote });
  if (error) throw error;
  return data;
}

/** Deletes the note from the site, or turns down a note that waits for
 *  approval. Either way it counts as disapproved. */
export async function deleteDraftNote(draftId: string): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_delete_note", { p_draft: draftId });
  if (error) throw error;
}

/** Hides the draft from the reviewer's own Not reviewed and Waiting sections,
 *  or shows it there again. */
export async function skipDraft(draftId: string, skip: boolean): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_skip", { p_draft: draftId, p_skip: skip });
  if (error) throw error;
}

/** Why the reviewer voted the way they did. */
export async function explainVote(draftId: string, text: string): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_explain", { p_draft: draftId, p_text: text });
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

/** Whether Claude's new notes wait for an admin's approval before they go up. */
export async function setApprovalRequired(required: boolean): Promise<void> {
  const { error } = await supabase.rpc("everything_claude_change_settings", { p_approval_required: required });
  if (error) throw error;
}
