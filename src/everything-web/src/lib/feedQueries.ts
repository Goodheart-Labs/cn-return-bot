import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { fetchProjects } from "@cn/core/creators";
import { fetchBestNotes } from "@cn/core/bestNotes";
import { fetchItemNoteViewers, fetchItemsByIds, fetchItemsWithNotes, fetchProjectItems } from "@cn/core/items";
import { fetchAllNnn, fetchNnnForClaims, fetchProjectNnn } from "@cn/core/noteNotNeeded";
import { fetchAllNotes, fetchNotesByIds, fetchProjectNote, fetchProjectNotes } from "@cn/core/notes";
import { subscribeToProjectChanges } from "@cn/core/projectRealtime";
import type { FeedItemRow, NnnRow, NoteRow } from "@cn/core/types";
import { noteSetOf, type NoteSet } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";

/* The website reads one project at a time, because that is what a creator's
 * feed shows. The All notes page is the exception and reads every note at
 * once. Every query names what it needs and lists the columns the page
 * renders. Switching page loads that page's notes, and the previous ones drop
 * out of the cache after a few minutes. */

/** The projects the sidebar lists. */
export const useProjects = () => useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects });

/** Where one feed's items, notes and note-not-needed entries come from, and
 *  the cache keys they are kept under. */
interface FeedSource {
  itemsKey: QueryKey;
  fetchItems: () => Promise<FeedItemRow[]>;
  noteSetKey: QueryKey;
  fetchNotes: () => Promise<NoteRow[]>;
  fetchNnn: () => Promise<NnnRow[]>;
  enabled: boolean;
}

function useFeed({ itemsKey, fetchItems, noteSetKey, fetchNotes, fetchNnn, enabled }: FeedSource) {
  const items = useQuery({
    queryKey: itemsKey,
    queryFn: fetchItems,
    enabled,
    select: (rows) => new Map(rows.map((r) => [r.id, r])),
  });
  const noteSet = useQuery({
    queryKey: noteSetKey,
    queryFn: async () => noteSetOf(...(await Promise.all([fetchNotes(), fetchNnn()]))),
    enabled,
  });
  return {
    items: items.data,
    noteSet: noteSet.data,
    failed: items.isError || noteSet.isError,
    retry: () => void Promise.all([items.refetch(), noteSet.refetch()]),
  };
}

/** One project's items, its notes and its note-not-needed entries, kept
 *  current over a realtime channel while the project is open. */
export function useProjectFeed(projectId: string | null) {
  const feed = useFeed({
    itemsKey: queryKeys.projectItems(projectId ?? ""),
    fetchItems: () => fetchProjectItems(projectId!),
    noteSetKey: queryKeys.projectNoteSet(projectId ?? ""),
    fetchNotes: () => fetchProjectNotes(projectId!),
    fetchNnn: () => fetchProjectNnn(projectId!),
    enabled: !!projectId,
  });
  useProjectRealtime(projectId);
  return feed;
}

/** Every visible note on the site, with the items they are on, for the All
 *  notes page. It has no realtime channel. A vote still shows up at once,
 *  because a vote refreshes its note in every cached NoteSet. Notes written
 *  by others appear when the page is opened again. */
export const useAllNotesFeed = () =>
  useFeed({
    itemsKey: queryKeys.itemsWithNotes,
    fetchItems: fetchItemsWithNotes,
    noteSetKey: queryKeys.allNoteSet,
    fetchNotes: fetchAllNotes,
    fetchNnn: fetchAllNnn,
    enabled: true,
  });

/** The best notes list in its order, the notes on it with their
 *  note-not-needed entries, and the posts they are on. Each step waits for the
 *  one before, because it needs its ids. The notes are a NoteSet under the
 *  `noteSet` prefix, so a vote shows up here as everywhere else. */
export function useBestNotesFeed() {
  const list = useQuery({ queryKey: queryKeys.bestNotes, queryFn: fetchBestNotes });
  const noteSet = useQuery({
    queryKey: queryKeys.bestNoteSet,
    queryFn: async () => {
      const notes = await fetchNotesByIds(list.data!.map((row) => row.note_id));
      return noteSetOf(notes, await fetchNnnForClaims(notes.map((note) => note.claim_id)));
    },
    enabled: !!list.data,
  });
  const items = useQuery({
    queryKey: queryKeys.bestNoteItems,
    queryFn: () => fetchItemsByIds([...new Set([...noteSet.data!.notes.values()].map((note) => note.claim.item_id))]),
    enabled: !!noteSet.data,
    select: (rows) => new Map(rows.map((r) => [r.id, r])),
  });
  return {
    list: list.data,
    noteSet: noteSet.data,
    items: items.data,
    failed: list.isError || noteSet.isError || items.isError,
    retry: () => void Promise.all([list.refetch(), noteSet.refetch(), items.refetch()]),
  };
}

/** How many devices outside the team saw each item's notes, which the All
 *  notes page filters by. */
export const useItemNoteViewers = () => useQuery({ queryKey: queryKeys.itemNoteViewers, queryFn: fetchItemNoteViewers });

/** Keeps only the columns the feed renders. A realtime message always carries
 *  the whole row, including the item's body text, and holding on to that
 *  would put back the memory the narrowed queries save. */
function toFeedItem(row: Record<string, unknown>): FeedItemRow {
  const { id, project_id, url, title, published_at, created_at } = row as FeedItemRow;
  return { id, project_id, url, title, published_at, created_at };
}

function updateNoteSet(client: QueryClient, projectId: string, update: (set: NoteSet) => NoteSet) {
  client.setQueryData<NoteSet>(queryKeys.projectNoteSet(projectId), (set) => set && update(set));
}

/** Applies realtime changes to the cached feed of the open project. */
function useProjectRealtime(projectId: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    const itemsKey = queryKeys.projectItems(projectId);
    const withNote = (note: NoteRow) => updateNoteSet(client, projectId, (set) => ({ ...set, notes: new Map(set.notes).set(note.id, note) }));
    /* A realtime change never carries the joined claim, so a note we have not
     * seen before is fetched in full. A note of another project comes back
     * null and is dropped. */
    const pullNote = async (id: string) => {
      const note = await fetchProjectNote(id, projectId);
      if (note) withNote(note);
    };
    return subscribeToProjectChanges(projectId, {
      onItem: (change) =>
        client.setQueryData<FeedItemRow[]>(itemsKey, (rows = []) =>
          change.type === "delete"
            ? rows.filter((r) => r.id !== change.id)
            : [...rows.filter((r) => r.id !== change.row.id), toFeedItem(change.row)],
        ),
      onNote: (change) => {
        if (change.type === "delete") {
          return updateNoteSet(client, projectId, (set) => {
            const notes = new Map(set.notes);
            notes.delete(change.id);
            return { ...set, notes };
          });
        }
        /* An update on a note we already hold only changes its vote counts. Its
         * plain fields are merged in, and the citations, the source-details flag
         * and the claim we already normalized are kept, because the raw row
         * carries none of them. */
        const existing = client.getQueryData<NoteSet>(queryKeys.projectNoteSet(projectId))?.notes.get(change.row.id);
        if (!existing) return void pullNote(change.row.id);
        const { sources: _s, has_source_details: _d, claim: _c, ...fields } = change.row as unknown as NoteRow;
        withNote({ ...existing, ...fields });
      },
      /* An entry is rendered under the notes on its claim, so an entry on a
       * claim we are not showing has nowhere to appear and is dropped. The
       * counter trigger sends its updates as full rows, so no refetch is
       * needed. */
      onNnn: (change) =>
        updateNoteSet(client, projectId, (set) => {
          const nnn = new Map(set.nnn);
          if (change.type === "delete") nnn.delete(change.id);
          else if ([...set.notes.values()].some((n) => n.claim_id === change.row.claim_id)) nnn.set(change.row.id, change.row as unknown as NnnRow);
          return { ...set, nnn };
        }),
    });
  }, [client, projectId]);
}
