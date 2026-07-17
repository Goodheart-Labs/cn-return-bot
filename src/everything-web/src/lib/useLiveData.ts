import { useEffect, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "../../../everything-shared/supabase";
import { detectSchema, fetchNote, noteSelect, normalizeNote } from "../../../everything-shared/notesQuery";
import type { ItemRow, NoteRow, ProjectRow } from "../../../everything-shared/types";

type RowMap<T> = Map<string, T>;

function upsertHandler<T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<RowMap<T>>>) {
  return (payload: RealtimePostgresChangesPayload<T>) => {
    setter((prev) => {
      const next = new Map(prev);
      if (payload.eventType === "DELETE") next.delete((payload.old as Partial<T>).id as string);
      else next.set((payload.new as T).id, payload.new as T);
      return next;
    });
  };
}

/** Live projects, items, and notes (with their claim). */
export function useLiveData() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [items, setItems] = useState<RowMap<ItemRow>>(new Map());
  const [notes, setNotes] = useState<RowMap<NoteRow>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const schema = await detectSchema();
      const [p, i, n] = await Promise.all([
        supabase.from("everything_projects").select("*").order("sort_order"),
        supabase.from("everything_items").select("*"),
        supabase.from("everything_notes").select(noteSelect(schema)),
      ]);
      if (cancelled) return;
      setProjects((p.data as ProjectRow[]) ?? []);
      setItems(new Map(((i.data as ItemRow[]) ?? []).map((r) => [r.id, r])));
      setNotes(new Map(((n.data ?? []) as any[]).map((r) => [r.id, normalizeNote(r, schema)])));
      setLoaded(true);
    }
    load();

    // Realtime deltas don't carry the joined claim, so fetch a new note in full;
    // for an UPDATE (vote counts) merge onto the existing row, keeping its claim.
    async function refetchNote(id: string) {
      const note = await fetchNote(id);
      if (note) setNotes((prev) => new Map(prev).set(id, note));
    }

    const channel = supabase
      .channel(`common-notes-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_items" }, upsertHandler(setItems))
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_notes" }, (payload) => {
        if (payload.eventType === "DELETE") {
          setNotes((prev) => {
            const next = new Map(prev);
            next.delete((payload.old as { id?: string }).id!);
            return next;
          });
        } else if (payload.eventType === "UPDATE") {
          const row = payload.new as any;
          setNotes((prev) => {
            const existing = prev.get(row.id);
            if (!existing) {
              refetchNote(row.id); // don't have it yet — fetch fresh + normalized
              return prev;
            }
            // Vote-count update: take the scalar fields but keep the already
            // normalized sources + claim (the raw row carries a raw jsonb
            // `sources` on the old schema, and never the joined claim).
            return new Map(prev).set(row.id, { ...existing, ...row, sources: existing.sources, claim: existing.claim ?? row.claim });
          });
        } else {
          refetchNote((payload.new as { id: string }).id);
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return { projects, items, notes, loaded };
}
