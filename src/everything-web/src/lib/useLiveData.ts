import { useEffect, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { ItemRow, NoteRow, ProjectRow, SuggestionRow } from "./types";

const NOTE_SELECT = "*, claim:everything_claims(id, item_id, claim, context_quote, context_url, start_seconds, end_seconds)";

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

/** Live projects, items, notes (with their claim), and accepted suggestions. */
export function useLiveData() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [items, setItems] = useState<RowMap<ItemRow>>(new Map());
  const [notes, setNotes] = useState<RowMap<NoteRow>>(new Map());
  const [suggestions, setSuggestions] = useState<RowMap<SuggestionRow>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [p, i, n, s] = await Promise.all([
        supabase.from("everything_projects").select("*").order("sort_order"),
        supabase.from("everything_items").select("*"),
        supabase.from("everything_notes").select(NOTE_SELECT),
        supabase.from("everything_note_suggestions").select("*"),
      ]);
      if (cancelled) return;
      setProjects((p.data as ProjectRow[]) ?? []);
      setItems(new Map(((i.data as ItemRow[]) ?? []).map((r) => [r.id, r])));
      setNotes(new Map(((n.data as NoteRow[]) ?? []).map((r) => [r.id, r])));
      setSuggestions(new Map(((s.data as SuggestionRow[]) ?? []).map((r) => [r.id, r])));
      setLoaded(true);
    }
    load();

    // Realtime deltas don't carry the joined claim, so fetch a new note in full;
    // for an UPDATE (vote counts) merge onto the existing row, keeping its claim.
    async function fetchNote(id: string) {
      const { data } = await supabase.from("everything_notes").select(NOTE_SELECT).eq("id", id).maybeSingle();
      if (data) setNotes((prev) => new Map(prev).set(id, data as NoteRow));
    }

    const channel = supabase
      .channel(`common-notes-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_items" }, upsertHandler(setItems))
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_note_suggestions" }, upsertHandler(setSuggestions))
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_notes" }, (payload) => {
        if (payload.eventType === "DELETE") {
          setNotes((prev) => {
            const next = new Map(prev);
            next.delete((payload.old as { id?: string }).id!);
            return next;
          });
        } else if (payload.eventType === "UPDATE") {
          const row = payload.new as NoteRow;
          setNotes((prev) => {
            const existing = prev.get(row.id);
            return new Map(prev).set(row.id, { ...existing, ...row, claim: existing?.claim ?? row.claim });
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

  return { projects, items, notes, suggestions, loaded };
}
