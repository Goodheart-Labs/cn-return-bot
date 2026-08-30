import { useEffect, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "../../../everything-shared/supabase";
import { randomUuid } from "./randomUuid";
import {
  fetchProjectItems,
  fetchProjectNnn,
  fetchProjectNote,
  fetchProjectNotes,
  fetchProjects,
} from "./feedData";
import type { FeedItemRow, FeedProjectRow, NnnRow, NoteRow } from "../../../everything-shared/types";

type RowMap<T> = Map<string, T>;

/** The projects in the sidebar. They are loaded once and they never change while
 *  the page is open. */
export function useProjects(): { projects: FeedProjectRow[]; failed: boolean } {
  const [projects, setProjects] = useState<FeedProjectRow[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchProjects()
      .then((rows) => { if (!cancelled) setProjects(rows); })
      /* Without this the sidebar stayed empty for ever and no project was ever
       * opened, so a reader whose first request failed sat in front of a page
       * that never finished loading and never said why. */
      .catch((err) => {
        console.error("Could not load the projects", err);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

  return { projects, failed };
}

/** Keeps only the columns the feed renders. A realtime message always carries
 *  the whole row, including the item's body text, and holding on to that would
 *  put back the memory the narrowed queries just saved. */
function toFeedItem(row: any): FeedItemRow {
  const { id, project_id, url, title, published_at, created_at } = row;
  return { id, project_id, url, title, published_at, created_at };
}

/** Loads one project's items, notes and note-not-needed entries, then keeps them
 *  up to date over a realtime channel. Switching project loads that project and
 *  drops the previous one, so the page only ever holds the notes it is showing.
 *
 *  Realtime is scoped the same way. Items are filtered on the project server
 *  side. Notes and entries carry no project column, so a change on a row we do
 *  not already have is resolved against a project-scoped query, and a row from
 *  another project comes back empty and is ignored. */
export function useProjectFeed(projectId: string | null) {
  const [items, setItems] = useState<RowMap<FeedItemRow>>(new Map());
  const [notes, setNotes] = useState<RowMap<NoteRow>>(new Map());
  const [nnn, setNnn] = useState<RowMap<NnnRow>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Bumped by retry() to run the load effect again.
  const [attempt, setAttempt] = useState(0);

  // The note-not-needed handler has to know which claims are on screen, and the
  // subscription is set up once per project, so it reads them through a ref
  // rather than closing over a notes map that is already out of date.
  const claimIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    claimIds.current = new Set([...notes.values()].map((n) => n.claim_id));
  }, [notes]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoaded(false);
    setFailed(false);

    /* Any one of these three can fail: the backend has brief outages, and a
     * reader's network or browser extension can block the request outright.
     * Before this was caught, the rejection went nowhere and `loaded` stayed
     * false, which left the reader looking at "Loading..." for ever. Now the
     * feed says what happened and offers to try again. */
    (async () => {
      try {
        const [i, n, e] = await Promise.all([
          fetchProjectItems(projectId),
          fetchProjectNotes(projectId),
          fetchProjectNnn(projectId),
        ]);
        if (cancelled) return;
        setItems(new Map(i.map((r) => [r.id, r])));
        setNotes(new Map(n.map((r) => [r.id, r])));
        setNnn(new Map(e.map((r) => [r.id, r])));
        setLoaded(true);
      } catch (err) {
        console.error("Could not load this project", err);
        if (!cancelled) setFailed(true);
      }
    })();

    /* A realtime change never carries the joined claim, so a note we have not
     * seen before is fetched in full. An update only changes the vote counts,
     * so it is merged onto the row we already have and keeps its claim. */
    async function pullNote(id: string) {
      const note = await fetchProjectNote(id, projectId!);
      if (note && !cancelled) setNotes((prev) => new Map(prev).set(id, note));
    }

    const deleteHandler = <T,>(setter: React.Dispatch<React.SetStateAction<RowMap<T>>>) =>
      (payload: RealtimePostgresChangesPayload<any>) => {
        setter((prev) => {
          const next = new Map(prev);
          next.delete((payload.old as { id?: string }).id!);
          return next;
        });
      };

    const channel = supabase
      .channel(`common-notes-${projectId}-${randomUuid()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "everything_items", filter: `project_id=eq.${projectId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return deleteHandler(setItems)(payload);
          setItems((prev) => new Map(prev).set((payload.new as { id: string }).id, toFeedItem(payload.new)));
        },
      )
      // An entry is rendered under the notes on its claim, so an entry on a claim
      // we are not showing has nowhere to appear and is dropped. The counter
      // trigger sends its updates as full rows, so no refetch is needed here.
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_note_not_needed" }, (payload) => {
        if (payload.eventType === "DELETE") return deleteHandler(setNnn)(payload);
        const row = payload.new as NnnRow;
        if (!claimIds.current.has(row.claim_id)) return;
        setNnn((prev) => new Map(prev).set(row.id, row));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_notes" }, (payload) => {
        if (payload.eventType === "DELETE") return deleteHandler(setNotes)(payload);
        const row = payload.new as any;
        if (payload.eventType === "INSERT") return void pullNote(row.id);
        setNotes((prev) => {
          const existing = prev.get(row.id);
          if (!existing) {
            // Either a note of another project, which the fetch drops, or one of
            // ours that we have not seen yet.
            void pullNote(row.id);
            return prev;
          }
          /* This is a vote-count update. Take the plain fields from it, but keep
           * the citations, the source-details flag and the claim we already
           * normalized. The raw row carries none of them. */
          return new Map(prev).set(row.id, {
            ...existing,
            ...row,
            sources: existing.sources,
            has_source_details: existing.has_source_details,
            claim: existing.claim,
          });
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [projectId, attempt]);

  return { items, notes, nnn, loaded, failed, retry: () => setAttempt((n) => n + 1) };
}
