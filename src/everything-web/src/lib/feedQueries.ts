import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchProjects } from "@cn/core/creators";
import { fetchProjectItems } from "@cn/core/items";
import { fetchProjectNnn } from "@cn/core/noteNotNeeded";
import { fetchProjectNote, fetchProjectNotes } from "@cn/core/notes";
import { subscribeToProjectChanges } from "@cn/core/projectRealtime";
import type { FeedItemRow, NnnRow, NoteRow } from "@cn/core/types";
import { noteSetOf, type NoteSet } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";

/* The website reads one project at a time, because that is what the feed
 * shows. Every query names the project it needs and lists the columns the
 * page renders. Switching project loads that project, and the previous one
 * drops out of the cache after a few minutes. */

/** The projects the sidebar lists. */
export const useProjects = () => useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects });

/** One project's items, its notes and its note-not-needed entries, kept
 *  current over a realtime channel while the project is open. */
export function useProjectFeed(projectId: string | null) {
  const items = useQuery({
    queryKey: queryKeys.projectItems(projectId ?? ""),
    queryFn: () => fetchProjectItems(projectId!),
    enabled: !!projectId,
    select: (rows) => new Map(rows.map((r) => [r.id, r])),
  });
  const noteSet = useQuery({
    queryKey: queryKeys.projectNoteSet(projectId ?? ""),
    queryFn: async () => noteSetOf(...(await Promise.all([fetchProjectNotes(projectId!), fetchProjectNnn(projectId!)]))),
    enabled: !!projectId,
  });
  useProjectRealtime(projectId);
  return {
    items: items.data,
    noteSet: noteSet.data,
    failed: items.isError || noteSet.isError,
    retry: () => void Promise.all([items.refetch(), noteSet.refetch()]),
  };
}

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
