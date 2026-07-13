/** Typed read/write helpers for the everything_* tables (service key). */

import { getSupabaseClient } from "../api/supabaseClient";
import type { SourceKind } from "./types";

export interface EverythingItem {
  id: string;
  source: SourceKind;
  url: string;
  title: string | null;
  published_at: string | null;
  status: "queued" | "processing" | "done" | "error";
}

export type ClaimStatus = "pending" | "skipped" | "no_note" | "note" | "error";

export interface NewClaimRow {
  item_id: string;
  claim: string;
  judgement: string;
  context_quote: string;
  context_paragraph: string | null;
  context_url: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  status: ClaimStatus;
  status_reason: string | null;
}

function throwOnError<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

/** Create or update a project (keyed by slug); returns its id. */
export async function upsertProject(project: {
  slug: string;
  name: string;
  description?: string;
  sort_order?: number;
}): Promise<string> {
  const row = throwOnError(
    await getSupabaseClient().from("everything_projects").upsert(project, { onConflict: "slug" }).select("id").single(),
  );
  return (row as { id: string }).id;
}

/** Create or update an item (keyed by url) and put it in 'processing'; returns the row. */
export async function upsertItem(item: {
  project_id: string;
  source: SourceKind;
  url: string;
  title: string;
}): Promise<EverythingItem> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .upsert({ ...item, status: "processing" }, { onConflict: "url" })
      .select("id, source, url, title, published_at, status")
      .single(),
  ) as EverythingItem;
}

/** Delete an item's claims (notes cascade) so a re-import starts clean. */
export async function deleteClaimsForItem(itemId: string): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_claims").delete().eq("item_id", itemId));
}

/** URLs of a project's already-completed items — lets an interrupted import resume. */
export async function fetchDoneItemUrls(projectId: string): Promise<Set<string>> {
  const rows = throwOnError(
    await getSupabaseClient().from("everything_items").select("url").eq("project_id", projectId).eq("status", "done"),
  );
  return new Set((rows ?? []).map((r: { url: string }) => r.url));
}

/** Insert new URLs into the queue; already-known URLs are ignored. Returns the inserted count. */
export async function enqueueItems(rows: { source: SourceKind; url: string }[]): Promise<number> {
  const inserted = throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
      .select("id"),
  );
  return inserted?.length ?? 0;
}

/** Oldest queued item → processing (single worker, so no locking needed). */
export async function claimNextQueuedItem(): Promise<EverythingItem | null> {
  const db = getSupabaseClient();
  const item = throwOnError<EverythingItem | null>(
    await db
      .from("everything_items")
      .select("id, source, url, title, published_at, status")
      .eq("status", "queued")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  );
  if (!item) return null;
  throwOnError(await db.from("everything_items").update({ status: "processing" }).eq("id", item.id));
  return { ...item, status: "processing" };
}

export async function updateItemMeta(id: string, meta: { title: string; published_at: string | null }): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_items").update(meta).eq("id", id));
}

export async function markItemDone(id: string): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .update({ status: "done", processed_at: new Date().toISOString() })
      .eq("id", id),
  );
}

export async function markItemError(id: string, error: string): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .update({ status: "error", error, processed_at: new Date().toISOString() })
      .eq("id", id),
  );
}

/** Insert claim rows; returns their ids in input order. */
export async function insertClaims(rows: NewClaimRow[]): Promise<string[]> {
  if (rows.length === 0) return [];
  const inserted = throwOnError(
    await getSupabaseClient().from("everything_claims").insert(rows).select("id"),
  );
  return (inserted ?? []).map((r: { id: string }) => r.id);
}

export async function setClaimStatus(id: string, status: ClaimStatus, reason: string | null): Promise<void> {
  throwOnError(
    await getSupabaseClient().from("everything_claims").update({ status, status_reason: reason }).eq("id", id),
  );
}

export async function insertNote(claimId: string, note: string, sources: string[]): Promise<void> {
  throwOnError(
    await getSupabaseClient().from("everything_notes").insert({ claim_id: claimId, note, sources }),
  );
}
