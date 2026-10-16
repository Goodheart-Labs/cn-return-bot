/**
 * Finds the Common Notes that might be worth posting on X: the notes that were
 * written, or that readers voted on, since a given time.
 *
 * A note is a candidate for one or more reasons:
 * - rated_helpful: the note is rated helpful now, by the website's rule
 *   (`noteStatus`), and it got a vote in the window. The vote may be the one
 *   that made it helpful.
 * - helpful_votes: someone other than its author voted it Helpful or Somewhat
 *   helpful in the window. The author's own vote, which a database trigger casts
 *   automatically, never counts.
 * - written_by_person: a person wrote or improved it in the window.
 * - important_creator: it was written in the window on one of a few creators
 *   that many people we want to reach read.
 *
 * These are only hints. The daily job reads every candidate and fact-checks it
 * before it suggests a note for posting.
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

const SITE = "https://commonnotes.net";
const HELPFUL: Vote = 1;
const SOMEWHAT_HELPFUL: Vote = 0;

export type Reason =
  | { type: "rated_helpful" }
  | { type: "helpful_votes"; helpful: number; somewhatHelpful: number; fromTeam: number }
  | { type: "written_by_person"; author: string }
  | { type: "important_creator" };

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

export async function findCandidates(since: string, posted: PostedLog): Promise<Candidate[]> {
  const db = getSupabaseClient();
  const [newNotes, recentVotes, teamIds] = await Promise.all([
    fetchAllRows<NoteRow>(() => db.from("everything_notes").select(NOTE_COLUMNS).neq("status", "hidden").gte("created_at", since), "id", {
      label: "new notes",
    }),
    fetchAllRows<{ id: string; note_id: string }>(() => db.from("everything_votes").select("id, note_id").gte("updated_at", since), "id", {
      label: "recent votes",
    }),
    teamVoterIds(),
  ]);
  const newNoteIds = new Set(newNotes.map((note) => note.id));
  const votedNoteIds = [...new Set(recentVotes.map((vote) => vote.note_id))].filter((id) => !newNoteIds.has(id));
  const votedNotes = await fetchInBatches<NoteRow>(
    (chunk) => db.from("everything_notes").select(NOTE_COLUMNS).neq("status", "hidden").in("id", chunk),
    votedNoteIds,
    "id",
    { label: "voted notes" },
  );
  const notes = [...newNotes, ...votedNotes];
  const noteIds = notes.map((note) => note.id);
  const [votes, sources, minisites] = await Promise.all([
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
}): Candidate | null {
  const { note, votes, teamIds, postedAt } = params;
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
  const isNew = note.created_at >= since;
  if (isNew && note.author_id) reasons.push({ type: "written_by_person", author: note.author_name ?? "a reader" });
  if (isNew && IMPORTANT_CREATOR_FEED_URLS.has(note.claim.item.project?.feed_url ?? "")) reasons.push({ type: "important_creator" });
  if (reasons.length === 0) return null;

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
  };
}

/** Readers' votes say more than our own heuristics, so they rank first. */
const REASON_WEIGHT: Record<Reason["type"], number> = {
  rated_helpful: 8,
  helpful_votes: 4,
  written_by_person: 2,
  important_creator: 1,
};

const strength = (candidate: Candidate) => candidate.reasons.reduce((sum, reason) => sum + REASON_WEIGHT[reason.type], 0);

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}
