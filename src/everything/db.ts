/** Typed read and write helpers for the everything_* tables. They all run with
 *  the service key. */

import { getSupabaseClient } from "../api/supabaseClient";
import { extractYoutubeVideoId } from "../everything-shared/pageUrls";
import { stripNullChars } from "../utils/stripNullChars";
import type { CanonicalFeed } from "./feedUrls";
import type { ItemSource, NoteSourceCitation } from "./types";

/** The queue's priority tiers. The worker takes the highest tier first, and the
 *  newest published content within a tier. */
export const QUEUE_PRIORITY = {
  /** An errored item on a repeat attempt. It already had its turn once, so it
   *  must never crowd out fresh content and drains last. */
  retry: -1,
  /** A post by a creator we walk only because readers visited them. */
  backlog: 0,
  /** A post by a creator whose priority window is still open, because someone
   *  pressed the button or ran everything-prioritize. */
  prioritized: 1,
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

/** Returns the project id for a creator or a slug, creating the project if we
 *  have never seen it.
 *
 *  The feed URL is tried first when the caller has one, because a creator's
 *  slug is not always what their URL derives to. Three creators were given a
 *  short slug by hand: thezvi.substack.com is project `zvi`, @DwarkeshPatel is
 *  `dwarkesh` and astralcodexten is `acx`. Looking those up by a derived slug
 *  would miss them and create a second, empty project, which would split their
 *  notes on the public site.
 *
 *  On an existing project the display name only fills in a slug placeholder;
 *  see fillDisplayName. */
export async function resolveProjectId(params: {
  slug: string;
  displayName?: string;
  feedUrl?: string;
}): Promise<string> {
  const { slug, displayName, feedUrl } = params;
  const db = getSupabaseClient();

  if (feedUrl) {
    const byFeed = throwOnError(
      await db.from("everything_projects").select("id, slug, name").eq("feed_url", feedUrl).maybeSingle(),
    ) as ProjectRow | null;
    if (byFeed) {
      await fillDisplayName(byFeed, displayName);
      return byFeed.id;
    }
  }

  const bySlug = throwOnError(
    await db.from("everything_projects").select("id, slug, name").eq("slug", slug).maybeSingle(),
  ) as ProjectRow | null;
  if (bySlug) {
    await fillDisplayName(bySlug, displayName);
    // A project ingested before we knew its feed learns it now, so the next
    // lookup finds it by feed URL.
    if (feedUrl) {
      throwOnError(await db.from("everything_projects").update({ feed_url: feedUrl }).eq("id", bySlug.id).is("feed_url", null));
    }
    return bySlug.id;
  }

  return (
    throwOnError(
      await db
        .from("everything_projects")
        .insert({ slug, name: displayName ?? slug, feed_url: feedUrl ?? null })
        .select("id")
        .single(),
    ) as { id: string }
  ).id;
}

/** Fills a project's display name by project id; see fillDisplayName. The
 *  worker calls this with the author name of the content it just fetched. */
export async function fillProjectDisplayName(projectId: string | null, displayName?: string): Promise<void> {
  if (!projectId || !displayName) return;
  const project = throwOnError(
    await getSupabaseClient().from("everything_projects").select("id, slug, name").eq("id", projectId).maybeSingle(),
  ) as ProjectRow | null;
  if (project) await fillDisplayName(project, displayName);
}

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

/** An errored item that still has repeat attempts left. */
export interface RetryableErrorItem {
  id: string;
  url: string;
  retries: number;
  priority: number;
}

/** Returns the errored items that have been requeued fewer than `maxRetries`
 *  times and whose last failure is at least `cooldownHours` old. The cool-down
 *  spaces the attempts out. Without it a failure whose cause lasts a while,
 *  say a broken proxy or an exhausted API key, would burn every retry within
 *  minutes and the item would be dead again before the cause clears. */
export async function fetchRetryableErrorItems(maxRetries: number, cooldownHours: number): Promise<RetryableErrorItem[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .select("id, url, retries, priority")
      .eq("status", "error")
      .lt("retries", maxRetries)
      .lt("processed_at", new Date(Date.now() - cooldownHours * 3600_000).toISOString()),
  ) as RetryableErrorItem[];
}

/** Puts an errored item back in the queue for a repeat attempt and counts the
 *  attempt. The last error text stays on the row until the item finishes, so a
 *  waiting retry still shows why the item failed. A requested page keeps its
 *  tier, because a reader is waiting for it. Every other item drains at the
 *  retry tier, behind all fresh content. */
export async function requeueErroredItem(item: RetryableErrorItem): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .update({
        status: "queued",
        retries: item.retries + 1,
        priority: item.priority >= QUEUE_PRIORITY.requested ? item.priority : QUEUE_PRIORITY.retry,
      })
      .eq("id", item.id),
  );
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
      .update({ status: "done", error: null, processed_at: new Date().toISOString() })
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

/** A creator we already know: a project row carrying the feed we poll. A
 *  creator IS a project (migration 086), so this is where their hand-picked
 *  slug, their priority window and their top-posts stamp all live. */
export interface CreatorProject {
  project_slug: string;
  feed_url: string;
  /** While this lies in the future the creator is walked ahead of creators that
   *  qualify only on visits. Null means they are walked only if readers visit
   *  them. */
  priority_until: string | null;
  /** When the creator's everything_top_posts rows were last recomputed. Null
   *  means never. */
  top_posts_refreshed_at: string | null;
}

/** Every creator we have a project for, whether or not they hold priority right
 *  now. The ranking needs the whole set, not just the prioritised ones: a
 *  creator walked on visits alone still has to be recognised as their existing
 *  project, or their notes would land in a second one under a derived slug. */
export async function fetchCreatorProjects(): Promise<CreatorProject[]> {
  const rows = throwOnError(
    await getSupabaseClient()
      .from("everything_projects")
      .select("slug, feed_url, priority_until, top_posts_refreshed_at")
      .not("feed_url", "is", null),
  ) as { slug: string; feed_url: string; priority_until: string | null; top_posts_refreshed_at: string | null }[];
  return rows.map((r) => ({
    project_slug: r.slug,
    feed_url: r.feed_url,
    priority_until: r.priority_until,
    top_posts_refreshed_at: r.top_posts_refreshed_at,
  }));
}

/** Gives a creator priority until the given time, creating their project if we
 *  have never seen them. An existing window is extended, never shortened, so a
 *  press cannot cut short a longer window the pipeline set. This is the
 *  service-role path used by the everything-prioritize script; a press from the
 *  extension goes through the trigger in migration 086 instead. */
export async function upsertCreatorPriority(feed: CanonicalFeed, until: Date): Promise<void> {
  const db = getSupabaseClient();
  const existing = throwOnError(
    await db.from("everything_projects").select("id, priority_until").eq("feed_url", feed.feed_url).maybeSingle(),
  ) as { id: string; priority_until: string | null } | null;

  if (existing) {
    if (existing.priority_until && Date.parse(existing.priority_until) >= until.getTime()) return;
    throwOnError(
      await db.from("everything_projects").update({ priority_until: until.toISOString() }).eq("id", existing.id),
    );
    return;
  }
  // The creator may already have a project under their slug without a feed URL,
  // which is how a project created by an ingest before migration 086 looks.
  const bySlug = throwOnError(
    await db.from("everything_projects").select("id").eq("slug", feed.project_slug).maybeSingle(),
  ) as { id: string } | null;
  if (bySlug) {
    throwOnError(
      await db
        .from("everything_projects")
        .update({ feed_url: feed.feed_url, priority_until: until.toISOString() })
        .eq("id", bySlug.id),
    );
    return;
  }
  throwOnError(
    await db.from("everything_projects").insert({
      slug: feed.project_slug,
      name: feed.project_slug,
      feed_url: feed.feed_url,
      priority_until: until.toISOString(),
    }),
  );
}

/** A cached top post of a followed creator (everything_top_posts, migration
 *  085). Popularity is the platform's own signal: view count for a YouTube
 *  video, like count for a Substack post. */
export interface TopPostRow {
  feed_url: string;
  source: "substack" | "youtube";
  url: string;
  title: string | null;
  published_at: string | null;
  popularity: number;
  rank: number;
}

/** Every cached top post, most popular first within each feed. The whole
 *  table is a few rows per followed creator. */
export async function fetchAllTopPosts(): Promise<TopPostRow[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_top_posts")
      .select("feed_url, source, url, title, published_at, popularity, rank")
      .order("feed_url")
      .order("rank"),
  ) as TopPostRow[];
}

/** Replaces one feed's cached top list with a fresh one and stamps the feed
 *  as refreshed. The stamp is set even for an empty list, because a creator
 *  with no checkable top posts must not look permanently stale. */
export async function replaceFeedTopPosts(feedUrl: string, rows: Omit<TopPostRow, "feed_url">[]): Promise<void> {
  const db = getSupabaseClient();
  throwOnError(await db.from("everything_top_posts").delete().eq("feed_url", feedUrl));
  if (rows.length > 0) {
    throwOnError(await db.from("everything_top_posts").insert(rows.map((r) => ({ ...r, feed_url: feedUrl }))));
  }
  throwOnError(
    await db
      .from("everything_projects")
      .update({ top_posts_refreshed_at: new Date().toISOString() })
      .eq("feed_url", feedUrl),
  );
}

/** One waiting item, for the queue overview the run logs. */
export interface QueuedItemSummary {
  id: string;
  status: "queued" | "processing";
  source: ItemSource;
  url: string;
  title: string | null;
  priority: number;
  created_at: string;
}

/** Everything waiting or in flight, in the order the worker takes it. The
 *  worker itself only ever sees one row at a time (claimNextQueuedItem), so
 *  this is the one read that can say how long the queue is and what is on it.
 *  It names its columns rather than selecting everything, so it never pulls the
 *  large full_text bodies. */
export async function fetchQueueOverview(): Promise<QueuedItemSummary[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .select("id, status, source, url, title, priority, created_at")
      .in("status", ["queued", "processing"])
      .order("priority", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: true })
      .order("created_at"),
  ) as QueuedItemSummary[];
}

/** Visit counts per creator feed since the given time, summed in the database
 *  (see everything_visit_counts, migration 083). */
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
