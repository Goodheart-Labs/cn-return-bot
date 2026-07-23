import { useEffect, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "../../../everything-shared/supabase";
import { detectSchema, noteSelect, normalizeNote } from "../../../everything-shared/notesQuery";
import type { ItemRow, NnnRow, NoteRow, ProjectRow } from "../../../everything-shared/types";

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

/** Live projects, items, notes (with their claim), and note-not-needed entries. */
export function useLiveData() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [items, setItems] = useState<RowMap<ItemRow>>(new Map());
  const [notes, setNotes] = useState<RowMap<NoteRow>>(new Map());
  const [nnn, setNnn] = useState<RowMap<NnnRow>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const schema = await detectSchema();
      const [p, i, n, e] = await Promise.all([
        supabase.from("everything_projects").select("*").order("sort_order"),
        supabase.from("everything_items").select("*"),
        supabase.from("everything_notes").select(noteSelect(schema)),
        schema.hasNnn
          ? supabase.from("everything_note_not_needed").select("*")
          : Promise.resolve({ data: [] as NnnRow[] }),
      ]);
      if (cancelled) return;
      setProjects((p.data as ProjectRow[]) ?? []);
      setItems(new Map(((i.data as ItemRow[]) ?? []).map((r) => [r.id, r])));
      setNotes(new Map(((n.data ?? []) as any[]).map((r) => [r.id, normalizeNote(r, schema)])));
      setNnn(new Map(((e.data as NnnRow[]) ?? []).map((r) => [r.id, r])));
      setLoaded(true);
    }
    load();

    // Realtime deltas don't carry the joined claim, so fetch a new note in full;
    // for an UPDATE (vote counts) merge onto the existing row, keeping its claim.
    async function fetchNote(id: string) {
      const schema = await detectSchema();
      const { data } = await supabase.from("everything_notes").select(noteSelect(schema)).eq("id", id).maybeSingle();
      if (data) setNotes((prev) => new Map(prev).set(id, normalizeNote(data, schema)));
    }

    const channel = supabase
      .channel(`common-notes-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_items" }, upsertHandler(setItems))
      // Note-not-needed entries have no joins, so the generic handler covers
      // all events (vote-count UPDATEs arrive as full rows via the counter trigger).
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_note_not_needed" }, upsertHandler(setNnn))
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
              fetchNote(row.id); // don't have it yet — fetch fresh + normalized
              return prev;
            }
            // Vote-count update: take the scalar fields but keep the already
            // normalized sources + claim (the raw row carries a raw jsonb
            // `sources` on the old schema, and never the joined claim).
            return new Map(prev).set(row.id, { ...existing, ...row, sources: existing.sources, claim: existing.claim ?? row.claim });
          });
        } else {
          fetchNote((payload.new as { id: string }).id);
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return { projects, items, notes, nnn, loaded };
}
