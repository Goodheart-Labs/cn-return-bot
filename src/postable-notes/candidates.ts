/**
 * Finds the Common Notes that might be worth posting on X, among the notes
 * that readers voted on, or that the note judge (GOO-591) judged, since a
 * given time. Jim set the rule on 2026-10-27 (GOO-622):
 *
 * - rated_helpful: the note is rated helpful now, by the website's rule
 *   (`noteStatus`), and it got a vote in the window. The vote may be the one
 *   that made it helpful. Such a note is always a candidate.
 * - Any other note is a candidate only when it looks promising and matters:
 *   - promising: someone other than its author voted it Helpful in the window
 *     (helpful_votes), or the judge gives it a high chance of ending up rated
 *     helpful (judged_promising). The author's own vote, which a database
 *     trigger casts automatically, never counts.
 *   - matters: it is on one of a few creators that many people we want to reach
 *     read, or the judge gives it a decent chance that the team puts it on its
 *     leaderboard.
 *
 * These are only hints. The daily job judges every candidate before it
 * suggests a note for posting.
 */

import { getSupabaseClient } from "../api/supabaseClient";
import { noteStatus, type NoteStatus } from "../everything-core/noteScore";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";
import { noteShareUrl } from "../everything-core/pageUrls";
import type { Vote } from "../everything-core/votes";
import { teamVoterIds } from "../everything/teamAccounts";

/** The creators Jim picked on 2026-09-24 (GOO-228): Astral Codex Ten, Andy
 *  Masley, Bentham's Bulldog, Predictive Text and Don't Worry About the Vase.
 *  They are matched by feed URL, because a project's slug is only a name. */
const IMPORTANT_CREATOR_FEED_URLS = new Set([
  "https://astralcodexten.substack.com",
  "https://andymasley.substack.com",
  "https://benthams.substack.com",
  "https://nathanpmyoung.substack.com",
  "https://thezvi.substack.com",
]);

/** A note the judge gives at least this chance of ending up rated helpful is
 *  promising. Over the week to 2026-10-27, one judged note in five reached it. */
const MIN_P_HELPFUL = 0.7;

/** A note the judge gives at least this chance of a place on the team's
 *  leaderboard matters even on a creator outside the list above. With
 *  MIN_P_HELPFUL this gave about 10 candidates a day over that week. */
const MIN_P_IMPACTFUL = 0.25;

const SITE = "https://commonnotes.net";
const HELPFUL: Vote = 1;
const SOMEWHAT_HELPFUL: Vote = 0;

export type Reason =
  | { type: "rated_helpful" }
  | { type: "helpful_votes"; helpful: number; somewhatHelpful: number; fromTeam: number }
  | { type: "judged_promising"; pHelpful: number };

/** The note judge's answer for a note's current text. */
export type Judgement = { pHelpful: number; pImpactful: number; reasoning: string; judgedAt: string };

type NoteRow = {
  id: string;
  note: string;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
  improved_from_note_id: string | null;
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  claim: {
    claim: string;
    judgement: string;
    context_quote: string | null;
    context_paragraph: string | null;
    image_urls: string[] | null;
    item: {
      id: string;
      title: string | null;
      url: string;
      project: { slug: string; name: string; feed_url: string | null } | null;
    };
  };
};

type VoteRow = { id: string; note_id: string; voter_id: string; vote: Vote; updated_at: string };
type SourceRow = { id: string; note_id: string; url: string; quote: string | null; explanation: string | null; sort_order: number };

export type Candidate = {
  noteId: string;
  reasons: Reason[];
  note: string;
  writtenAt: string;
  author: string | null;
  isImprovement: boolean;
  passage: string | null;
  paragraph: string | null;
  claim: string;
  judgement: string;
  imageUrls: string[];
  item: { title: string; url: string; creator: string | null; feedUrl: string | null };
  tally: { helpful: number; somewhatHelpful: number; notHelpful: number; fromTeam: number };
  status: NoteStatus;
  statusWithoutTeam: NoteStatus;
  noteUrl: string;
  minisiteUrl: string | null;
  sources: { url: string; quote: string | null; explanation: string | null }[];
  /** When the job last posted this note, if it did. Such a note only comes back
   *  when it got a new Helpful or Somewhat helpful vote since. */
  postedAt: string | null;
  /** The note judge's answer, for notes of the Claude note writer it judged. */
  judge: Judgement | null;
  /** Whether the note is on one of the important creators. */
  importantCreator: boolean;
};

/** Note ids mapped to when the job posted them in Slack. */
export type PostedLog = Map<string, string>;

const NOTE_COLUMNS =
  "id, note, created_at, author_id, author_name, improved_from_note_id, helpful_count, somewhat_helpful_count, not_helpful_count, " +
  "claim:everything_claims!inner(claim, judgement, context_quote, context_paragraph, image_urls, " +
  "item:everything_items!inner(id, title, url, project:everything_projects(slug, name, feed_url)))";

/** One line per post: the note id, a space, and the ISO time it was posted. */
export function parsePostedLog(text: string): PostedLog {
  const log: PostedLog = new Map();
  for (const line of text.split("\n")) {
    const [noteId, postedAt] = line.trim().split(/\s+/);
    if (noteId && postedAt) log.set(noteId, postedAt);
  }
  return log;
}

type DraftRow = { id: string; note_id: string };
type JudgementRow = { draft_id: string; note: string; p_helpful: number; p_impactful: number; reasoning: string; judged_at: string };

/** The judge's answers for these notes, by note id. An answer about an older
 *  text of the note, from before a rewrite, is left out. */
async function fetchJudgements(notes: NoteRow[]): Promise<Map<string, Judgement>> {
  const db = getSupabaseClient();
  const drafts = await fetchInBatches<DraftRow>(
    (chunk) => db.from("everything_claude_drafts").select("id, note_id").in("note_id", chunk),
    notes.map((note) => note.id),
    "id",
    { label: "drafts" },
  );
  const judgements = await fetchInBatches<JudgementRow>(
    (chunk) => db.from("everything_claude_judgements").select("draft_id, note, p_helpful, p_impactful, reasoning, judged_at").in("draft_id", chunk),
    drafts.map((draft) => draft.id),
    "draft_id",
    { label: "judgements" },
  );
  const noteIdByDraft = new Map(drafts.map((draft) => [draft.id, draft.note_id]));
  const textById = new Map(notes.map((note) => [note.id, note.note]));
  const byNote = new Map<string, Judgement>();
  for (const row of judgements) {
    const noteId = noteIdByDraft.get(row.draft_id);
    if (!noteId || textById.get(noteId) !== row.note) continue;
    byNote.set(noteId, { pHelpful: row.p_helpful, pImpactful: row.p_impactful, reasoning: row.reasoning, judgedAt: row.judged_at });
  }
  return byNote;
}

export async function findCandidates(since: string, posted: PostedLog): Promise<Candidate[]> {
  const db = getSupabaseClient();
  const [recentJudgements, recentVotes, teamIds] = await Promise.all([
    fetchAllRows<{ draft_id: string }>(() => db.from("everything_claude_judgements").select("draft_id").gte("judged_at", since), "draft_id", {
      label: "recent judgements",
    }),
    fetchAllRows<{ id: string; note_id: string }>(() => db.from("everything_votes").select("id, note_id").gte("updated_at", since), "id", {
      label: "recent votes",
    }),
    teamVoterIds(),
  ]);
  const judgedDrafts = await fetchInBatches<DraftRow>(
    (chunk) => db.from("everything_claude_drafts").select("id, note_id").in("id", chunk).not("note_id", "is", null),
    recentJudgements.map((judgement) => judgement.draft_id),
    "id",
    { label: "judged drafts" },
  );
  const noteIds = [...new Set([...judgedDrafts.map((draft) => draft.note_id), ...recentVotes.map((vote) => vote.note_id)])];
  const notes = await fetchInBatches<NoteRow>(
    (chunk) => db.from("everything_notes").select(NOTE_COLUMNS).neq("status", "hidden").in("id", chunk),
    noteIds,
    "id",
    { label: "notes" },
  );
  const [votes, sources, minisites, judgements] = await Promise.all([
    fetchInBatches<VoteRow>(
      (chunk) => db.from("everything_votes").select("id, note_id, voter_id, vote, updated_at").in("note_id", chunk),
      noteIds,
      "id",
      { label: "votes" },
    ),
    fetchInBatches<SourceRow>(
      (chunk) => db.from("everything_note_sources").select("id, note_id, url, quote, explanation, sort_order").in("note_id", chunk),
      noteIds,
      "id",
      { label: "sources" },
    ),
    fetchInBatches<{ id: string; item_id: string; slug: string }>(
      (chunk) => db.from("everything_minisites").select("id, item_id, slug").in("item_id", chunk),
      [...new Set(notes.map((note) => note.claim.item.id))],
      "id",
      { label: "minisites" },
    ),
    fetchJudgements(notes),
  ]);
  const votesByNote = groupBy(votes, (vote) => vote.note_id);
  const sourcesByNote = groupBy(sources, (source) => source.note_id);
  const minisiteSlugByItem = new Map(minisites.map((minisite) => [minisite.item_id, minisite.slug]));

  return notes
    .map((note) =>
      toCandidate({
        note,
        votes: votesByNote.get(note.id) ?? [],
        sources: sourcesByNote.get(note.id) ?? [],
        minisiteSlug: minisiteSlugByItem.get(note.claim.item.id) ?? null,
        teamIds,
        since,
        postedAt: posted.get(note.id) ?? null,
        judge: judgements.get(note.id) ?? null,
      }),
    )
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((a, b) => strength(b) - strength(a) || b.writtenAt.localeCompare(a.writtenAt));
}

/** Builds the candidate, or returns null when the note has no reason to be one. */
export function toCandidate(params: {
  note: NoteRow;
  votes: VoteRow[];
  sources: SourceRow[];
  minisiteSlug: string | null;
  teamIds: Set<string>;
  since: string;
  postedAt: string | null;
  judge: Judgement | null;
}): Candidate | null {
  const { note, votes, teamIds, postedAt, judge } = params;
  const othersVotes = votes.filter((vote) => vote.voter_id !== note.author_id);
  const isPositive = (vote: VoteRow) => vote.vote === HELPFUL || vote.vote === SOMEWHAT_HELPFUL;
  // A note posted before only comes back for votes that arrived after the post.
  const since = postedAt && postedAt > params.since ? postedAt : params.since;
  const newPositiveVotes = othersVotes.filter((vote) => isPositive(vote) && vote.updated_at >= since);
  if (postedAt && newPositiveVotes.length === 0) return null;

  const withoutTeam = othersVotes.filter((vote) => !teamIds.has(vote.voter_id));
  const status = noteStatus(note);
  const reasons: Reason[] = [];
  if (status === "helpful" && votes.some((vote) => vote.updated_at >= since)) reasons.push({ type: "rated_helpful" });
  if (newPositiveVotes.length > 0) {
    reasons.push({
      type: "helpful_votes",
      helpful: newPositiveVotes.filter((vote) => vote.vote === HELPFUL).length,
      somewhatHelpful: newPositiveVotes.filter((vote) => vote.vote === SOMEWHAT_HELPFUL).length,
      fromTeam: newPositiveVotes.filter((vote) => teamIds.has(vote.voter_id)).length,
    });
  }
  if (judge && judge.judgedAt >= since && judge.pHelpful >= MIN_P_HELPFUL) reasons.push({ type: "judged_promising", pHelpful: judge.pHelpful });
  const importantCreator = IMPORTANT_CREATOR_FEED_URLS.has(note.claim.item.project?.feed_url ?? "");
  const matters = importantCreator || (judge !== null && judge.pImpactful >= MIN_P_IMPACTFUL);
  const gotHelpfulVote = newPositiveVotes.some((vote) => vote.vote === HELPFUL);
  const promising = gotHelpfulVote || reasons.some((reason) => reason.type === "judged_promising");
  const ratedHelpful = reasons.some((reason) => reason.type === "rated_helpful");
  if (!ratedHelpful && !(promising && matters)) return null;

  const { claim } = note;
  const { item } = claim;
  return {
    noteId: note.id,
    reasons,
    note: note.note,
    writtenAt: note.created_at,
    author: note.author_id ? (note.author_name ?? "a reader") : null,
    isImprovement: note.improved_from_note_id !== null,
    passage: claim.context_quote,
    paragraph: claim.context_paragraph,
    claim: claim.claim,
    judgement: claim.judgement,
    imageUrls: claim.image_urls ?? [],
    item: { title: item.title?.trim() || item.url, url: item.url, creator: item.project?.name ?? null, feedUrl: item.project?.feed_url ?? null },
    tally: {
      helpful: note.helpful_count,
      somewhatHelpful: note.somewhat_helpful_count,
      notHelpful: note.not_helpful_count,
      fromTeam: votes.filter((vote) => teamIds.has(vote.voter_id)).length,
    },
    status,
    // These votes already leave out the author's own vote, so author_id is null
    // and noteStatus does not take that vote out a second time.
    statusWithoutTeam: noteStatus({
      author_id: null,
      helpful_count: withoutTeam.filter((vote) => vote.vote === HELPFUL).length,
      somewhat_helpful_count: withoutTeam.filter((vote) => vote.vote === SOMEWHAT_HELPFUL).length,
      not_helpful_count: withoutTeam.filter((vote) => vote.vote !== HELPFUL && vote.vote !== SOMEWHAT_HELPFUL).length,
    }),
    noteUrl: noteShareUrl(item.project?.slug ?? null, note.id),
    minisiteUrl: params.minisiteSlug ? `${SITE}/minisites/${params.minisiteSlug}` : null,
    sources: params.sources
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((source) => ({ url: source.url, quote: source.quote, explanation: source.explanation })),
    postedAt,
    judge,
    importantCreator,
  };
}

/** Readers' votes say more than our own heuristics, so they rank first. */
const REASON_WEIGHT: Record<Reason["type"], number> = {
  rated_helpful: 8,
  helpful_votes: 4,
  judged_promising: 2,
};

const strength = (candidate: Candidate) => candidate.reasons.reduce((sum, reason) => sum + REASON_WEIGHT[reason.type], 0);

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}
