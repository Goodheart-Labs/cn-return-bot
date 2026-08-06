/** Typed read/write helpers for the everything_* tables (service key). */

import { getSupabaseClient } from "../api/supabaseClient";
import type { NoteSourceCitation, SourceKind } from "./types";

export interface EverythingItem {
  id: string;
  source: SourceKind;
  url: string;
  title: string | null;
  published_at: string | null;
  status: "queued" | "processing" | "done" | "error";
  /** Pre-supplied body for a local `--doc` item (read from a file at enqueue);
   *  null for a live URL the worker fetches. Also the searchable text post-ingest. */
  full_text: string | null;
}

const ITEM_COLUMNS = "id, source, url, title, published_at, status, full_text";

export type ClaimStatus = "pending" | "skipped" | "no_note" | "note" | "error";

export interface NewClaimRow {
  item_id: string;
  claim: string;
  judgement: string;
  context_quote: string | null;
  context_paragraph: string | null;
  image_urls: string[];
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

/** Project id for a slug, creating a bare project (name = slug) if it's new.
 *  Never overwrites an existing project's name/description. */
export async function resolveProjectId(slug: string): Promise<string> {
  const db = getSupabaseClient();
  const existing = throwOnError(
    await db.from("everything_projects").select("id").eq("slug", slug).maybeSingle(),
  ) as { id: string } | null;
  if (existing) return existing.id;
  return (throwOnError(await db.from("everything_projects").insert({ slug, name: slug }).select("id").single()) as {
    id: string;
  }).id;
}

// A url-less local doc still needs a unique, non-null `url` (the column is NOT
// NULL UNIQUE). We mint a synthetic key under this scheme; it is never shown as
// a source link — buildClaimRow leaves such a claim's context_url null.
const LOCAL_DOC_URL_PREFIX = "local:";
export const syntheticDocUrl = (slug: string, basename: string) => `${LOCAL_DOC_URL_PREFIX}${slug}/${basename}`;
export const isSyntheticDocUrl = (url: string | null): boolean => !!url?.startsWith(LOCAL_DOC_URL_PREFIX);

/** A queued item: a live URL (worker fetches) or a local `--doc` (body supplied). */
export interface EnqueueRow {
  project_id: string;
  source: SourceKind;
  url: string;
  title?: string; // known for --doc items; live URLs get their title from the worker fetch
  full_text?: string; // pre-supplied body for --doc items; absent for live URLs
}

/** Insert new items into the queue; already-known URLs are ignored. Returns the inserted count. */
export async function enqueueItems(rows: EnqueueRow[]): Promise<number> {
  const inserted = throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
      .select("id"),
  );
  return inserted?.length ?? 0;
}

/** Urls among the given ones that already have an item row (any status). */
export async function fetchItemUrlsIn(urls: string[]): Promise<string[]> {
  if (urls.length === 0) return [];
  const rows = throwOnError(
    await getSupabaseClient().from("everything_items").select("url").in("url", urls),
  ) as { url: string }[];
  return rows.map((r) => r.url);
}

/** Item urls containing any of the given fragments (e.g. YouTube video ids —
 *  stored URL forms vary, so items are matched by id, not exact url). */
export async function fetchItemUrlsContaining(fragments: string[]): Promise<string[]> {
  if (fragments.length === 0) return [];
  const rows = throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .select("url")
      .or(fragments.map((f) => `url.like.*${f}*`).join(",")),
  ) as { url: string }[];
  return rows.map((r) => r.url);
}

/** Fail items stranded in `processing` by a killed run. The caller must know no
 *  worker is live (the workflow's concurrency group guarantees that); marking
 *  error instead of re-queueing avoids duplicate claims from a partial run.
 *  Returns the failed items' urls. */
export async function markOrphanedProcessingAsError(): Promise<string[]> {
  const rows = throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .update({ status: "error", error: "orphaned in processing by a killed run", processed_at: new Date().toISOString() })
      .eq("status", "processing")
      .select("url"),
  ) as { url: string }[];
  return rows.map((r) => r.url);
}

/** Oldest queued item → processing (single worker, so no locking needed). */
export async function claimNextQueuedItem(): Promise<EverythingItem | null> {
  const db = getSupabaseClient();
  const item = throwOnError<EverythingItem | null>(
    await db
      .from("everything_items")
      .select(ITEM_COLUMNS)
      .eq("status", "queued")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  );
  if (!item) return null;
  throwOnError(await db.from("everything_items").update({ status: "processing" }).eq("id", item.id));
  return { ...item, status: "processing" };
}

export async function updateItemMeta(
  id: string,
  meta: { title: string; published_at: string | null; full_text: string },
): Promise<void> {
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

/** Insert an AI note plus one everything_note_sources row per cited snippet. */
export async function insertNote(claimId: string, note: string, sources: NoteSourceCitation[]): Promise<void> {
  const db = getSupabaseClient();
  const inserted = throwOnError(
    await db.from("everything_notes").insert({ claim_id: claimId, note }).select("id").single(),
  ) as { id: string };
  if (sources.length === 0) return;
  throwOnError(
    await db.from("everything_note_sources").insert(
      sources.map((s, i) => ({
        note_id: inserted.id,
        url: s.url,
        quote: s.quote,
        explanation: s.explanation,
        sort_order: i,
      })),
    ),
  );
}
