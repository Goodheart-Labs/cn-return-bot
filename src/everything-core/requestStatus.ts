import type { ProgressClaimRow, ProgressItemRow, RequestStatusRow } from "./requestProgress";
import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";

/* The reads behind the extension's live progress card for a requested page.
 * requestProgress.ts turns what they return into the lines the card shows. */

/** Exchanges a request's client token for its status row (migration 087).
 *  Null means the intake has not written the row yet. */
export async function fetchRequestStatus(token: string): Promise<RequestStatusRow | null> {
  const { data, error } = await supabase.rpc("everything_request_status", { token });
  if (error) throw error;
  return (data as RequestStatusRow[])[0] ?? null;
}

/** The columns of a requested item that the progress card shows. */
export async function fetchProgressItemRow(itemId: string): Promise<ProgressItemRow | null> {
  const { data, error } = await supabase
    .from("everything_items")
    .select("id, status, checked_scope, progress")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  return data as ProgressItemRow | null;
}

/** The status of every claim on a requested item. */
export async function fetchProgressClaimRows(itemId: string): Promise<ProgressClaimRow[]> {
  return fetchAllRows<ProgressClaimRow>(
    () => supabase.from("everything_claims").select("id, status").eq("item_id", itemId),
    "id",
    { label: "progressClaims" },
  );
}

/** Calls `onChange` whenever the item, one of its claims, or any note changes,
 *  and `onConnected` once the channel is live. The events carry no data the
 *  caller should use: an item row can carry 500 KB of body text and realtime
 *  truncates large records, so each event is only a signal to refetch.
 *  Returns the function that closes the channel. */
export function subscribeToItemProgress(itemId: string, onChange: () => void, onConnected: () => void): () => void {
  // The random suffix keeps two cards on two tabs from colliding on the shared
  // client. crypto.randomUUID does not exist in a content script on an
  // insecure page, so plain Math.random has to do.
  const nonce = Math.random().toString(36).slice(2);
  const channel = supabase
    .channel(`cn-request-${itemId}-${nonce}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "everything_items", filter: `id=eq.${itemId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "everything_claims", filter: `item_id=eq.${itemId}` }, onChange)
    // Note inserts cannot be filtered to the item, because a note row only
    // knows its claim. An insert for another item costs one narrow refetch.
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "everything_notes" }, onChange)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onConnected();
    });
  return () => void supabase.removeChannel(channel);
}
