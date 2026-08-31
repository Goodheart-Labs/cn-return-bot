/** Typed read and write helpers for the everything_* tables. They all run with
 *  the service key. */

import { getSupabaseClient } from "../api/supabaseClient";
import { extractYoutubeVideoId } from "../everything-shared/pageUrls";
import { stripNullChars } from "../utils/stripNullChars";
import type { ItemSource, NoteSourceCitation } from "./types";

/** The queue's priority tiers. The worker takes the highest tier first, and the
 *  newest published content within a tier. */
export const QUEUE_PRIORITY = {
  /** The curated priority feeds. */
  backlog: 0,
  /** A post from a feed a reader asked us to follow. */
  followed: 1,
  /** A page a reader explicitly requested notes on. */
  requested: 2,
} as const;

export interface EverythingItem {
  id: string;
  project_id: string | null;
  source: ItemSource;
  url: string;
  title: string | null;
  published_at: string | null;
  status: "queued" | "processing" | "done" | "error";
  /** The body text supplied up front for a local `--doc` item, read from a file
   *  at enqueue time. It is null for a live URL that the worker fetches. Once an
   *  item has been ingested this column also holds the text that the public
   *  write-note flow searches. */
  full_text: string | null;
}

const ITEM_COLUMNS = "id, project_id, source, url, title, published_at, status, full_text";

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

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
}

/** Writes a project's real display name once a fetch has learned it. A project
 *  created before its name was known carries its slug as the name, and only
 *  such a placeholder is ever replaced. A name that differs from the slug was
 *  set deliberately, by a seed migration or by hand, and is left alone. */
async function fillDisplayName(project: ProjectRow, displayName: string | undefined): Promise<void> {
  if (!displayName || displayName === project.slug || project.name !== project.slug) return;
  throwOnError(await getSupabaseClient().from("everything_projects").update({ name: displayName }).eq("id", project.id));
  console.log(`Project "${project.slug}" display name set to "${displayName}"`);
}

/** Returns the project id for a slug. A slug we have not seen before creates
 *  the project, named by `displayName` when the caller knows it and by the
 *  slug otherwise. On an existing project the display name only fills in a
 *  slug placeholder; see fillDisplayName. */
export async function resolveProjectId(slug: string, displayName?: string): Promise<string> {
  const db = getSupabaseClient();
  const existing = throwOnError(
    await db.from("everything_projects").select("id, slug, name").eq("slug", slug).maybeSingle(),
  ) as ProjectRow | null;
  if (existing) {
    await fillDisplayName(existing, displayName);
    return existing.id;
  }
  return (
    throwOnError(
      await db.from("everything_projects").insert({ slug, name: displayName ?? slug }).select("id").single(),
    ) as { id: string }
  ).id;
}

async function fillDisplayNameWhere(column: "id" | "slug", value: string, displayName: string | undefined): Promise<void> {
  if (!displayName) return;
  const project = throwOnError(
    await getSupabaseClient().from("everything_projects").select("id, slug, name").eq(column, value).maybeSingle(),
  ) as ProjectRow | null;
  if (project) await fillDisplayName(project, displayName);
}

/** Fills a project's display name by project id; see fillDisplayName. The
 *  worker calls this with the author name of the content it just fetched. */
export const fillProjectDisplayName = (projectId: string | null, displayName?: string): Promise<void> =>
  projectId ? fillDisplayNameWhere("id", projectId, displayName) : Promise.resolve();

/** Fills a project's display name by slug, without creating the project; see
 *  fillDisplayName. The follow-request consumer calls this, because a followed
 *  feed's project may or may not exist yet. */
export const fillProjectDisplayNameBySlug = (slug: string, displayName?: string): Promise<void> =>
  fillDisplayNameWhere("slug", slug, displayName);

// A local doc with no url still needs a unique, non-null `url`, because the
// column is NOT NULL UNIQUE. We mint a synthetic key under this prefix. Such a
// key is never shown as a source link. buildClaimRow recognizes one and leaves
// the claim's context_url null.
const LOCAL_DOC_URL_PREFIX = "local:";
export const syntheticDocUrl = (slug: string, basename: string) => `${LOCAL_DOC_URL_PREFIX}${slug}/${basename}`;
export const isSyntheticDocUrl = (url: string | null): boolean => !!url?.startsWith(LOCAL_DOC_URL_PREFIX);

/** What the pipeline was asked to read for an item. `page` is the whole
 *  article or transcript. `paragraph` is only the passage a reader
 *  highlighted, which is then the item's entire text. Null means no pipeline
 *  run was ever intended: a reader-written note created the row. A page
 *  counts as checked only when the item is done AND the scope is `page`. */
export type CheckedScope = "page" | "paragraph" | null;

/** An item to put in the queue. It is either a live URL that the worker fetches,
 *  or an item whose body we already have. Local `--doc` files and posts read
 *  from a priority feed's RSS are the second kind. */
export interface EnqueueRow {
  project_id: string;
  source: ItemSource;
  url: string;
  title?: string; // We know this when the body is supplied. A live URL gets its title from the worker's fetch.
  full_text?: string; // The body we already have. A live URL carries none here.
  published_at?: string; // We know this at enqueue for an RSS-fed item. Otherwise the worker sets it.
  priority?: number; // A QUEUE_PRIORITY tier. Left out it defaults to the backlog tier.
  checked_scope?: "page" | "paragraph"; // Left out it defaults to a whole-page check.
}

/** Inserts new items into the queue and returns how many were inserted. A URL we
 *  already have is ignored. Every row is padded to the same set of keys, because
 *  PostgREST rejects a bulk insert whose rows have differing keys. */
export async function enqueueItems(rows: EnqueueRow[]): Promise<number> {
  const padded = rows.map((r) => ({ title: null, full_text: null, published_at: null, priority: QUEUE_PRIORITY.backlog, checked_scope: "page", ...r }));
  const inserted = throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .upsert(padded, { onConflict: "url", ignoreDuplicates: true })
      .select("id"),
  );
  return inserted?.length ?? 0;
}

/** Inserts one queue item and returns its id. The request consumer uses this,
 *  because it links the request row to the item it became. The caller has
 *  already checked that the URL is new. */
export async function insertQueuedItem(row: EnqueueRow): Promise<string> {
  const inserted = throwOnError(
    await getSupabaseClient().from("everything_items").insert(row).select("id").single(),
  ) as { id: string };
  return inserted.id;
}

/** Raises an item's priority to at least the given tier. It never lowers one. */
export async function raiseItemPriority(id: string, priority: number): Promise<void> {
  throwOnError(
    await getSupabaseClient().from("everything_items").update({ priority }).eq("id", id).lt("priority", priority),
  );
}

/** Finds the item a page URL resolves to, whatever its status. A YouTube page is
 *  matched by its video id, because the stored URL forms vary. Any other URL is
 *  matched exactly, apart from a trailing slash. This mirrors the extension's
 *  fetchItemForUrl. */
export async function findItemForPageUrl(
  pageUrl: string,
): Promise<{ id: string; status: string; checked_scope: CheckedScope } | null> {
  const db = getSupabaseClient();
  const videoId = extractYoutubeVideoId(pageUrl);
  if (videoId) {
    // ilike reads an underscore in the video id as a wildcard, so this is only a
    // prefilter. Every row it returns is verified by comparing the id exactly.
    const rows = throwOnError(
      await db.from("everything_items").select("id, status, checked_scope, url").ilike("url", `%${videoId}%`),
    ) as { id: string; status: string; checked_scope: CheckedScope; url: string }[];
    const hit = rows.find((r) => extractYoutubeVideoId(r.url) === videoId);
    return hit ? { id: hit.id, status: hit.status, checked_scope: hit.checked_scope } : null;
  }
  const trimmed = pageUrl.replace(/\/$/, "");
  const rows = throwOnError(
    await db.from("everything_items").select("id, status, checked_scope").in("url", [trimmed, `${trimmed}/`]).limit(1),
  ) as { id: string; status: string; checked_scope: CheckedScope }[];
  return rows[0] ?? null;
}

/** Turns an existing item into a whole-page check and puts it back in the
 *  queue at the given priority tier. The item's claims and notes are kept, and
 *  the worker redoes only the unfinished ones. full_text is always
 *  overwritten. Keeping a paragraph item's old text would make the worker
 *  re-check the same paragraph and then record it as a whole-page check. Null
 *  makes the worker fetch the page itself. */
export async function promoteItemToWholePage(id: string, fullText: string | null, priority: number): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .update({ checked_scope: "page", full_text: fullText, status: "queued", error: null })
      .eq("id", id),
  );
  await raiseItemPriority(id, priority);
}

/** An existing item row seen from the feed walker: where it lives and what
 *  kind of check it stands for. */
export interface KnownItemUrl {
  id: string;
  url: string;
  checked_scope: CheckedScope;
}

/** Returns the given urls that already have an item row, whatever its status. */
export async function fetchItemUrlsIn(urls: string[]): Promise<KnownItemUrl[]> {
  if (urls.length === 0) return [];
  return throwOnError(
    await getSupabaseClient().from("everything_items").select("id, url, checked_scope").in("url", urls),
  ) as KnownItemUrl[];
}

/** Returns the item urls that contain any of the given fragments. We use this
 *  for YouTube video ids. The stored URL forms vary, so an item is matched by
 *  its video id rather than by an exact url. */
export async function fetchItemUrlsContaining(fragments: string[]): Promise<KnownItemUrl[]> {
  if (fragments.length === 0) return [];
  return throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .select("id, url, checked_scope")
      .or(fragments.map((f) => `url.like.*${f}*`).join(",")),
  ) as KnownItemUrl[];
}

/** Returns the items that a killed run left stranded in `processing`. This is
 *  only meaningful while no worker is running. The workflow's concurrency group
 *  guarantees that. */
export async function fetchOrphanedProcessingItems(): Promise<{ id: string; url: string }[]> {
  return throwOnError(
    await getSupabaseClient().from("everything_items").select("id, url").eq("status", "processing"),
  ) as { id: string; url: string }[];
}

/** Puts a stranded item back in the queue so the worker resumes it. Its claims
 *  already exist, and the worker redoes only the unfinished ones. */
export async function requeueItem(id: string): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_items").update({ status: "queued" }).eq("id", id));
}

export interface ItemClaimRow {
  id: string;
  claim: string;
  judgement: string;
  context_quote: string | null;
  context_paragraph: string | null;
  image_urls: string[];
  status: ClaimStatus;
}

/** Returns all claims of an item, in insertion order. A non-empty result means
 *  claim extraction for that item finished. */
export async function fetchItemClaims(itemId: string): Promise<ItemClaimRow[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_claims")
      .select("id, claim, judgement, context_quote, context_paragraph, image_urls, status")
      .eq("item_id", itemId)
      .order("created_at"),
  ) as ItemClaimRow[];
}

/** Moves the next queued item to `processing` and returns it. The highest
 *  priority tier wins, and within a tier the newest published content comes
 *  first. An item with no published date yet, which is typically a freshly
 *  requested live URL, sorts before the dated ones of its tier, and the oldest
 *  request among those is served first. Only one worker ever runs, so no
 *  locking is needed. */
export async function claimNextQueuedItem(): Promise<EverythingItem | null> {
  const db = getSupabaseClient();
  const item = throwOnError<EverythingItem | null>(
    await db
      .from("everything_items")
      .select(ITEM_COLUMNS)
      .eq("status", "queued")
      .order("priority", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: true })
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

/** Inserts the claim rows and returns their ids in input order. */
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

/** One fact-check run of a claim. This is the everything pipeline's counterpart
 *  of a pipeline_runs row. */
export interface ClaimPipelineRun {
  claim_id: string;
  bot_name: string;
  outcome: string;
  outcome_reason: string | null;
  final_stage: string | null;
  ab_test_picks: Record<string, string> | null;
  bot_config: Record<string, unknown> | null;
  logs: Record<string, unknown> | null;
  cost: number | null;
}

/** We scrub NUL characters here, the same way pipeline_runs does. Model output
 *  can contain U+0000, media OCR especially, and Postgres rejects such a value
 *  with error 22P05. */
export async function insertClaimPipelineRun(run: ClaimPipelineRun): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_pipeline_runs").insert(stripNullChars(run)));
}

/** Returns the given claims that already have an AI note. An AI note is one with
 *  a null author_id, so a user's draft does not count. A resume uses this to
 *  spot a run that was killed between insertNote and setClaimStatus. Such a
 *  claim is finalized rather than rechecked, because rechecking it would insert
 *  a second note. */
export async function fetchClaimIdsWithAiNotes(claimIds: string[]): Promise<Set<string>> {
  if (claimIds.length === 0) return new Set();
  const rows = throwOnError(
    await getSupabaseClient().from("everything_notes").select("claim_id").is("author_id", null).in("claim_id", claimIds),
  ) as { claim_id: string }[];
  return new Set(rows.map((r) => r.claim_id));
}

// ---------------------------------------------------------------------------
// Reader requests. Clients write these tables through their insert-only
// policies; the pipeline's request consumer reads and resolves them here with
// the service key.
// ---------------------------------------------------------------------------

export interface NoteRequestRow {
  id: string;
  page_url: string;
  page_title: string;
  selection: string | null;
  page_text: string | null;
}

export type NoteRequestStatus = "enqueued" | "done" | "skipped" | "error";

/** The unconsumed note requests, oldest first. */
export async function fetchPendingNoteRequests(): Promise<NoteRequestRow[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_note_requests")
      .select("id, page_url, page_title, selection, page_text")
      .eq("status", "pending")
      .order("created_at"),
  ) as NoteRequestRow[];
}

export async function resolveNoteRequest(
  id: string,
  status: NoteRequestStatus,
  reason: string | null,
  itemId: string | null,
): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_note_requests")
      .update({ status, status_reason: reason, item_id: itemId })
      .eq("id", id),
  );
}

export interface FollowRequestRow {
  id: string;
  feed_type: "substack" | "youtube";
  feed_url: string;
  title: string;
}

export type FollowRequestStatus = "accepted" | "skipped" | "error";

/** The unconsumed follow requests, oldest first. */
export async function fetchPendingFollowRequests(): Promise<FollowRequestRow[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_follow_requests")
      .select("id, feed_type, feed_url, title")
      .eq("status", "pending")
      .order("created_at"),
  ) as FollowRequestRow[];
}

export async function resolveFollowRequest(id: string, status: FollowRequestStatus, reason: string | null): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_follow_requests")
      .update({ status, status_reason: reason })
      .eq("id", id),
  );
}

export interface FollowedFeed {
  project_slug: string;
  feed_type: "substack" | "youtube";
  feed_url: string;
  /** The QUEUE_PRIORITY tier this feed's items enqueue at: `followed` for a
   *  reader-requested feed, `backlog` for the curated ones. */
  priority: number;
  /** While this lies in the future, the creator ranks strictly above every
   *  unflagged creator. Set by the everything-prioritize script. */
  priority_until: string | null;
}

/** Every feed the pipeline polls, in stored order: highest priority tier
 *  first, then the feed's own sort_order, then age. The creator ranking
 *  reorders this by reader attention before the feeds are walked. Migration
 *  077 seeds the curated feeds (Zvi, Dwarkesh, …); reader follows are added
 *  by the request consumer. */
export async function fetchFollowedFeeds(): Promise<FollowedFeed[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_followed_feeds")
      .select("project_slug, feed_type, feed_url, priority, priority_until")
      .order("priority", { ascending: false })
      .order("sort_order")
      .order("created_at"),
  ) as FollowedFeed[];
}

/** Adds a reader-requested feed to the followed list, at the followed tier
 *  (the column default). A feed we already follow is left alone. */
export async function insertFollowedFeed(feed: Omit<FollowedFeed, "priority" | "priority_until">): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_followed_feeds")
      .upsert(feed, { onConflict: "feed_url", ignoreDuplicates: true }),
  );
}

/** Flags a creator as priority until the given time, creating the feed row if
 *  we do not follow them yet (at the followed tier, like a reader follow). */
export async function upsertFeedPriority(
  feed: Omit<FollowedFeed, "priority" | "priority_until">,
  until: Date,
): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_followed_feeds")
      .upsert({ ...feed, priority_until: until.toISOString() }, { onConflict: "feed_url" }),
  );
}

/** Visit counts per creator feed since the given time, summed in the database
 *  (see everything_visit_counts, migration 082). */
export async function fetchVisitCounts(since: Date): Promise<{ feed_url: string; visits: number }[]> {
  return (throwOnError(
    await getSupabaseClient().rpc("everything_visit_counts", { since: since.toISOString() }),
  ) ?? []) as { feed_url: string; visits: number }[];
}

/** Total LLM cost in USD recorded in everything_pipeline_runs since the given
 *  time. The sum runs in the database, because a plain row fetch is capped at
 *  1000 rows and would quietly undercount a busy day. */
export async function fetchCostSinceUsd(since: Date): Promise<number> {
  const total = throwOnError(
    await getSupabaseClient().rpc("everything_cost_since", { since: since.toISOString() }),
  ) as number | string | null;
  return Number(total ?? 0);
}

/** Inserts an AI note and one everything_note_sources row per cited snippet. */
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
