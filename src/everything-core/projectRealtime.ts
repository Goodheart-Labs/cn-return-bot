import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/** One row change a realtime channel reported: a row that now reads `row`, or
 *  a row that was deleted. The row arrives as the raw table row, with none of
 *  the joins a query would add. */
export type RowChange<T> = { type: "upsert"; row: T } | { type: "delete"; id: string };

type Row = Record<string, unknown> & { id: string };

function toRowChange(payload: RealtimePostgresChangesPayload<Row>): RowChange<Row> {
  return payload.eventType === "DELETE"
    ? { type: "delete", id: (payload.old as Partial<Row>).id! }
    : { type: "upsert", row: payload.new };
}

/** Follows the changes that can touch one project's feed while a reader looks
 *  at it, and returns the function that stops following them. Items are
 *  filtered to the project on the server. Notes and note-not-needed entries
 *  carry no project column, so every change to them arrives here, and the
 *  caller drops the ones on rows it does not show. */
export function subscribeToProjectChanges(projectId: string, handlers: {
  onItem: (change: RowChange<Row>) => void;
  onNote: (change: RowChange<Row>) => void;
  onNnn: (change: RowChange<Row>) => void;
}): () => void {
  // Two tabs on the same project need distinct channel names. crypto.randomUUID
  // does not exist on insecure pages, so plain Math.random has to do.
  const nonce = Math.random().toString(36).slice(2);
  const channel = supabase
    .channel(`common-notes-${projectId}-${nonce}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "everything_items", filter: `project_id=eq.${projectId}` }, (p) =>
      handlers.onItem(toRowChange(p as RealtimePostgresChangesPayload<Row>)))
    .on("postgres_changes", { event: "*", schema: "public", table: "everything_notes" }, (p) =>
      handlers.onNote(toRowChange(p as RealtimePostgresChangesPayload<Row>)))
    .on("postgres_changes", { event: "*", schema: "public", table: "everything_note_not_needed" }, (p) =>
      handlers.onNnn(toRowChange(p as RealtimePostgresChangesPayload<Row>)))
    .subscribe();
  return () => void supabase.removeChannel(channel);
}
