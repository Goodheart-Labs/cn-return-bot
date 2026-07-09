import { useEffect, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { ClaimRow, ItemRow, NoteRow } from "./types";

type RowMap<T> = Map<string, T>;

function upsertHandler<T extends { id: string }>(
  setter: React.Dispatch<React.SetStateAction<RowMap<T>>>,
) {
  return (payload: RealtimePostgresChangesPayload<T>) => {
    setter((prev) => {
      const next = new Map(prev);
      if (payload.eventType === "DELETE") next.delete((payload.old as Partial<T>).id as string);
      else next.set((payload.new as T).id, payload.new as T);
      return next;
    });
  };
}

/** Initial fetch of the three everything_* tables + realtime deltas on top. */
export function useLiveData() {
  const [items, setItems] = useState<RowMap<ItemRow>>(new Map());
  const [claims, setClaims] = useState<RowMap<ClaimRow>>(new Map());
  const [notes, setNotes] = useState<RowMap<NoteRow>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [i, c, n] = await Promise.all([
        supabase.from("everything_items").select("*"),
        supabase.from("everything_claims").select("*"),
        supabase.from("everything_notes").select("*"),
      ]);
      if (cancelled) return;
      setItems(new Map(((i.data as ItemRow[]) ?? []).map((r) => [r.id, r])));
      setClaims(new Map(((c.data as ClaimRow[]) ?? []).map((r) => [r.id, r])));
      setNotes(new Map(((n.data as NoteRow[]) ?? []).map((r) => [r.id, r])));
      setLoaded(true);
    }
    load();

    const channel = supabase
      .channel("everything")
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_items" }, upsertHandler(setItems))
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_claims" }, upsertHandler(setClaims))
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_notes" }, upsertHandler(setNotes))
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return { items, claims, notes, loaded };
}
