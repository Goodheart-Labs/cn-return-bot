import type { Json } from "./database.types";
import { fetchItemsWithProjects } from "./items";
import { fetchNnnForClaims } from "./noteNotNeeded";
import { fetchNotesByIds } from "./notes";
import { supabase } from "./supabase";
import type { FeedItemRow, NnnRow, NoteRow, ProjectHeader } from "./types";

/* The website's notes feed, one page at a time (migration 141). The database
 * ranks and filters the notes and returns the ids of one page. A second step
 * loads what the cards of that page render. */

/** The orders a reader can pick on the All notes page. `mixed` is the order
 *  every project's own page uses. */
export type FeedOrder = "mixed" | "recent" | "helpful";

/** The band of the feed a note sits in. The mixed order has three: the main
 *  feed, the unhelpful notes, and the notes whose source text has since
 *  changed. The other orders put every note in `all`. */
export type FeedBand = "main" | "unhelpful" | "stale" | "all";

/** Which notes a feed shows: every note on the site, one project's, or one
 *  item's. */
export interface FeedScope {
  projectId: string | null;
  itemId: string | null;
}

/** The minimums a note must reach to stay in the feed. `views` belongs to the
 *  note's post: it counts the devices outside our team on which the extension
 *  showed that post's notes. The three vote minimums count all votes, Helpful
 *  votes and Not helpful votes. */
export interface NoteMinimums {
  views: number;
  votes: number;
  helpful: number;
  notHelpful: number;
}

/** Everything that decides which notes stay in the feed. With `unvotedOnly`,
 *  the notes the reader had voted on before `votedBefore` are hidden. That
 *  includes the notes they wrote, because posting a note casts a Helpful vote
 *  on it. */
export interface NoteFilters extends NoteMinimums {
  unvotedOnly: boolean;
}

/** No filter at all. */
export const NO_FILTERS: NoteFilters = { views: 0, votes: 0, helpful: 0, notHelpful: 0, unvotedOnly: false };

/** How many notes one page holds. Every YouTube card starts a video player,
 *  so a page stays small. */
export const FEED_PAGE_SIZE = 30;

/** Where the next page starts. The database makes it and reads it back, and
 *  nothing else looks inside. */
export type FeedBookmark = Json;

export interface FeedPageIds {
  /** `views` counts the devices outside our team on which the extension
   *  showed the notes of the note's post. */
  notes: { id: string; band: FeedBand; views: number }[];
  /** Null after the last page. */
  next: FeedBookmark | null;
}

/** The filter arguments both feed functions take. */
const filterArgs = (scope: FeedScope, filters: NoteFilters, votedBefore: Date) => ({
  p_project_id: scope.projectId ?? undefined,
  p_item_id: scope.itemId ?? undefined,
  p_min_views: filters.views,
  p_min_votes: filters.votes,
  p_min_helpful: filters.helpful,
  p_min_not_helpful: filters.notHelpful,
  p_unvoted_only: filters.unvotedOnly,
  p_voted_before: votedBefore.toISOString(),
});

/** One page of the feed: the ids of its notes in order, each with its band
 *  and its post's views, and the bookmark for the page after it. `votedBefore` is the moment the
 *  reader opened the feed, so a vote cast since then never hides its card. */
export async function fetchFeedPageIds(scope: FeedScope, order: FeedOrder, filters: NoteFilters, votedBefore: Date, after: FeedBookmark | null): Promise<FeedPageIds> {
  const { data, error } = await supabase.rpc("everything_note_feed_page", {
    ...filterArgs(scope, filters, votedBefore),
    p_order: order,
    p_after: after ?? undefined,
    p_limit: FEED_PAGE_SIZE,
  });
  if (error) throw error;
  return data as unknown as FeedPageIds;
}

/** The counts the feed shows besides its pages. `since` counts the matching
 *  notes created at or after each of the moments the caller asked about. */
export interface FeedSummary {
  matching: number;
  bands: Record<Exclude<FeedBand, "all">, number>;
  since: number[];
}

export async function fetchFeedSummary(scope: FeedScope, filters: NoteFilters, votedBefore: Date, since: Date[]): Promise<FeedSummary> {
  const { data, error } = await supabase.rpc("everything_note_feed_summary", {
    ...filterArgs(scope, filters, votedBefore),
    p_since: since.map((moment) => moment.toISOString()),
  });
  if (error) throw error;
  return data as unknown as FeedSummary;
}

/** Everything a list of note cards renders: the notes in the order asked for,
 *  the note-not-needed entries on their claims, and the posts the notes are
 *  on with the projects those posts belong to. */
export interface NoteCards {
  notes: NoteRow[];
  nnn: NnnRow[];
  items: FeedItemRow[];
  projects: ProjectHeader[];
}

/** Loads the cards of the notes with these ids, in this order. A note that was
 *  deleted or hidden since the ids were read is left out. */
export async function fetchNoteCards(ids: string[]): Promise<NoteCards> {
  if (ids.length === 0) return { notes: [], nnn: [], items: [], projects: [] };
  const byId = new Map((await fetchNotesByIds(ids)).map((note) => [note.id, note]));
  const notes = ids.flatMap((id) => byId.get(id) ?? []);
  const [nnn, posts] = await Promise.all([
    fetchNnnForClaims([...new Set(notes.map((note) => note.claim_id))]),
    fetchItemsWithProjects([...new Set(notes.map((note) => note.claim.item_id))]),
  ]);
  return { notes, nnn, ...posts };
}
