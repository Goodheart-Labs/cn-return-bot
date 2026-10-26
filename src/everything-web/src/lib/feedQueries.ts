import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CURATION_PAGE_SIZE,
  fetchCurationPage,
  fetchCurationSummary,
  fetchLeaderboard,
  type CuratedNoteRow,
  type CurationFilters,
  type CurationRow,
  type CurationSection,
} from "@cn/core/bestNotes";
import { fetchProjectBySlug, fetchProjectsPage, PROJECTS_PAGE_SIZE, type ProjectOrder } from "@cn/core/creators";
import {
  fetchFeedPageIds,
  fetchFeedSummary,
  fetchNoteCards,
  type FeedBand,
  type FeedBookmark,
  type FeedOrder,
  type FeedScope,
  type NoteFilters,
  NO_FILTERS,
} from "@cn/core/feedPages";
import { fetchFeedItem, fetchProjectItemsPage, PROJECT_ITEMS_PAGE_SIZE, type ProjectItemRow } from "@cn/core/items";
import { subscribeToProjectChanges } from "@cn/core/projectRealtime";
import type { FeedItemRow, FeedProjectRow, NnnRow, NoteRow, ProjectHeader } from "@cn/core/types";
import { useSession } from "@cn/features/auth/useSession";
import { noteSetOf, patchNoteInNoteSets, removeNnnFromNoteSets, removeNoteFromNoteSets, upsertNnnInNoteSets, type NoteSet } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";
import { afterFullPage, usePagedList } from "@cn/features/query/usePagedList";

/* Every list on the website loads one page at a time as the reader scrolls
 * (GOO-524). The database orders and filters each list and returns one page,
 * and usePagedList asks for the next page when the end of the list nears the
 * screen. A list of notes loads its notes in two steps: the database names
 * the notes of the page, and then the cards of exactly those notes load. */

/** One loaded page of note cards. It is a NoteSet, so a vote anywhere updates
 *  its notes. `entries` are the page's rows in order, and `items` and
 *  `projects` are the posts and projects the cards name. */
export interface CardPage<TEntry extends { noteId: string }> extends NoteSet {
  entries: TEntry[];
  items: Map<string, FeedItemRow>;
  projects: Map<string, ProjectHeader>;
}

async function loadCardPage<TEntry extends { noteId: string }>(entries: TEntry[]): Promise<CardPage<TEntry>> {
  const cards = await fetchNoteCards(entries.map((entry) => entry.noteId));
  return {
    ...noteSetOf(cards.notes, cards.nnn),
    entries,
    items: new Map(cards.items.map((item) => [item.id, item])),
    projects: new Map(cards.projects.map((project) => [project.id, project])),
  };
}

/** A moment that stays fixed until `key` changes. A feed hides the notes the
 *  reader had voted on when they opened it, and this is that moment. */
function useMomentFor(key: string): Date {
  const [moment, setMoment] = useState({ key, at: new Date() });
  // Taking a new moment during render is React's pattern for state derived
  // from props: React re-renders straight away with the new moment.
  if (moment.key !== key) setMoment({ key, at: new Date() });
  return moment.key === key ? moment.at : new Date();
}

/** One note of a feed page: which note, the band it sits in, and how many
 *  readers saw its post's notes. */
export interface FeedEntry {
  noteId: string;
  band: FeedBand;
  views: number;
}

export type FeedPage = CardPage<FeedEntry> & { next: FeedBookmark | null };

/** A notes feed and the counts it shows besides its pages. `since` lists the
 *  moments whose counts the Newest order's dividers need. The feed hides the
 *  notes the reader had voted on when it opened, so voting never makes a card
 *  vanish. The pages are dropped when the feed leaves the screen, so opening
 *  it again ranks the notes afresh. */
export function useNoteFeed(scope: FeedScope, order: FeedOrder, filters: NoteFilters, since: Date[] = []) {
  const userId = useSession().session?.user.id ?? null;
  // A feed for another reader hides other votes, so the reader is part of
  // what names the feed.
  const named = { ...filters, userId };
  const votedBefore = useMomentFor(JSON.stringify([scope, order, named]));
  const list = usePagedList({
    queryKey: queryKeys.noteFeed(scope, order, named),
    fetchPage: async (after: FeedBookmark | null): Promise<FeedPage> => {
      const page = await fetchFeedPageIds(scope, order, filters, votedBefore, after);
      const entries = page.notes.map(({ id, band, views }) => ({ noteId: id, band, views }));
      return { ...(await loadCardPage(entries)), next: page.next };
    },
    firstBookmark: null as FeedBookmark | null,
    nextBookmark: (page) => page.next ?? undefined,
    keepAfterLeaving: false,
  });
  const sinceIso = since.map((moment) => moment.toISOString());
  const summary = useQuery({
    queryKey: queryKeys.noteFeedSummary(scope, named, sinceIso),
    queryFn: () => fetchFeedSummary(scope, filters, votedBefore, since),
    // The filter controls read the counts, so they stay on screen while the
    // counts for new filters load.
    placeholderData: keepPreviousData,
  });
  return { list, summary };
}

/** How many visible notes the scope holds, without any filter. */
export const useNoteCount = (scope: FeedScope, enabled = true) =>
  useQuery({ queryKey: queryKeys.noteCount(scope), queryFn: async () => (await fetchFeedSummary(scope, NO_FILTERS, new Date(), [])).matching, enabled });

/** The note a shared link points at, with what its card renders. Its project
 *  page shows it first, because the feed may hold it on a page far below. */
export function useSharedNote(noteId: string | null) {
  return useQuery({
    queryKey: queryKeys.sharedNote(noteId ?? ""),
    queryFn: (): Promise<CardPage<FeedEntry>> => loadCardPage([{ noteId: noteId!, band: "main" as const, views: 0 }]),
    enabled: !!noteId,
  });
}

/** The pages of the projects overview in one order. */
export const useProjectsList = (order: ProjectOrder) =>
  usePagedList({
    queryKey: queryKeys.projectsPage(order),
    fetchPage: (after: FeedProjectRow | null) => fetchProjectsPage(order, after),
    firstBookmark: null as FeedProjectRow | null,
    nextBookmark: afterFullPage(PROJECTS_PAGE_SIZE),
  });

/** The project with this slug. Undefined while it loads, null when there is
 *  none. */
export const useProject = (slug: string) => useQuery({ queryKey: queryKeys.project(slug), queryFn: () => fetchProjectBySlug(slug) });

/** The pages of one project's list of posts, newest first. */
export const useProjectItems = (projectId: string) =>
  usePagedList({
    queryKey: queryKeys.projectItems(projectId),
    fetchPage: (after: ProjectItemRow | null) => fetchProjectItemsPage(projectId, after),
    firstBookmark: null as ProjectItemRow | null,
    nextBookmark: afterFullPage(PROJECT_ITEMS_PAGE_SIZE),
  });

/** One post by id, for the heading of a project page that shows only that
 *  post's notes. */
export const useFeedItem = (itemId: string | null) =>
  useQuery({ queryKey: queryKeys.feedItem(itemId ?? ""), queryFn: () => fetchFeedItem(itemId!), enabled: !!itemId });

/** One note of a curation section, with its row. */
export interface CurationEntry {
  noteId: string;
  row: CurationRow;
}

/** The pages of one curation section, narrowed by the filters. */
export function useCurationSection(section: CurationSection, filters: Omit<CurationFilters, "votedBefore">) {
  const votedBefore = useMomentFor(JSON.stringify([section, filters]));
  return usePagedList({
    queryKey: queryKeys.curationSection(section, filters),
    fetchPage: async (after: CurationRow | null) => {
      const rows = await fetchCurationPage(section, { ...filters, votedBefore }, after);
      return loadCardPage(rows.map((row) => ({ noteId: row.note_id, row })));
    },
    firstBookmark: null as CurationRow | null,
    nextBookmark: (page) => afterFullPage(CURATION_PAGE_SIZE)(page.entries)?.row,
  });
}

/** The section counts and the creators of the open section. */
export const useCurationSummary = (section: CurationSection) =>
  useQuery({ queryKey: queryKeys.curationSummary(section), queryFn: () => fetchCurationSummary(section) });

/** The whole leaderboard with its cards, which only the reorder mode loads. */
export const useWholeLeaderboard = (enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.wholeLeaderboard,
    queryFn: async (): Promise<CardPage<{ noteId: string; row: CuratedNoteRow }>> =>
      loadCardPage((await fetchLeaderboard()).map((row) => ({ noteId: row.note_id, row }))),
    enabled,
  });

/** Keeps the notes of an open project current over a realtime channel, a
 *  websocket on which Supabase pushes every change to the tables. Votes and
 *  edits on the notes on screen show at once, and so do note-not-needed
 *  entries on their claims. A new note appears when the page is opened again,
 *  because only the database knows where in the feed it belongs. */
export function useProjectRealtime(projectId: string) {
  const client = useQueryClient();
  useEffect(
    () =>
      subscribeToProjectChanges(projectId, {
        onNote: (change) => {
          if (change.type === "delete") return removeNoteFromNoteSets(client, change.id);
          // A raw row carries none of the joins a query adds, so only its plain
          // fields are merged into the note we hold.
          const { sources: _s, has_source_details: _d, claim: _c, ...fields } = change.row as unknown as NoteRow;
          patchNoteInNoteSets(client, change.row.id, fields);
        },
        // The counter trigger sends its updates as full rows, so no refetch is
        // needed.
        onNnn: (change) =>
          change.type === "delete" ? removeNnnFromNoteSets(client, change.id) : upsertNnnInNoteSets(client, change.row as unknown as NnnRow),
      }),
    [client, projectId],
  );
}
