/** Typed read and write helpers for the everything_* tables. They all run with
 *  the service key. */

import { getSupabaseClient } from "../api/supabaseClient";
import { extractYoutubeVideoId } from "../everything-core/pageUrls";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";
import { SOURCE_UNREACHABLE_TEXT } from "../pipeline/media/youtubeCaptions";
import { stripNullChars } from "../utils/stripNullChars";
import type { CanonicalFeed } from "./feedUrls";
import type { FeedPacingSnapshot, MeanCostRule } from "./pacing";
import { USAGE_WINDOW_HOURS, type UsageSnapshot } from "./usagePacing";
import { CLAUDE_NOTEWRITER, PIPELINE_NOTEWRITER } from "../notewriters/ids";
import type { HandedOutPost } from "../notewriters/v1";
import type { WatchedNotewriter } from "./notewriterSilence";
import type { ItemSource } from "./types";

export interface EverythingItem {
  id: string;
  project_id: string | null;
  source: ItemSource;
  url: string;
  title: string | null;
  published_at: string | null;
  status: "queued" | "processing" | "done" | "error";
  /** Set while a reader waits on the post: when the oldest open request came
   *  in (migration 184). It is what tells reader work apart from feed work. */
  requested_since: string | null;
  /** The body text supplied up front for a local `--doc` item, read from a file
   *  at enqueue time. It is null for a live URL that the worker fetches. Once an
   *  item has been ingested this column also holds the text that the public
   *  write-note flow searches. */
  full_text: string | null;
  /** How many repeat attempts this item has been given after failing. */
  retries: number;
  checked_scope: CheckedScope;
  /** When the page first finished as a whole-page check (migration 133). */
  first_checked_at: string | null;
}

const ITEM_COLUMNS = "id, project_id, source, url, title, published_at, status, requested_since, full_text, checked_scope, first_checked_at, retries";

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
  feed_url: string | null;
}

const PROJECT_COLUMNS = "id, slug, name, feed_url";

/** Where a display name was learned. The creator's own feed listing (the
 *  Substack RSS title, the YouTube channel name, the forum author's display
 *  name) is the name the source shows today. A single post says less: a
 *  Substack byline names the author, not the publication. */
type DisplayNameOrigin = "feed" | "post";

/** Writes a project's display name once a fetch has learned it.
 *
 *  A project that has a feed always shows the name its source shows, so a name
 *  learned from that feed's listing replaces whatever the row holds, including
 *  a name somebody typed in by hand. Jim decided that on 2026-09-14: no
 *  Substack or YouTube project may carry a custom name.
 *
 *  A name learned from a single post only fills in a placeholder. A project
 *  created before its name was known carries its slug as the name, and that is
 *  the only name such a fetch may replace. */
async function fillDisplayName(project: ProjectRow, displayName: string | undefined, origin: DisplayNameOrigin): Promise<void> {
  if (!displayName || displayName === project.name) return;
  const sourceNameWins = origin === "feed" && project.feed_url !== null;
  const isPlaceholder = project.name === project.slug && displayName !== project.slug;
  if (!sourceNameWins && !isPlaceholder) return;
  throwOnError(await getSupabaseClient().from("everything_projects").update({ name: displayName }).eq("id", project.id));
  console.log(`Project "${project.slug}" display name set to "${displayName}" (was "${project.name}")`);
}

/** The first of `base`, `base-2`, `base-3`, ... that no project uses yet. The
 *  same rule the press trigger in migration 086 applies, so a creator gets the
 *  same slug whichever path first meets them. */
async function freeSlug(base: string): Promise<string> {
  const db = getSupabaseClient();
  for (let suffix = 1; ; suffix++) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const taken = throwOnError(
      await db.from("everything_projects").select("id").eq("slug", candidate).maybeSingle(),
    ) as { id: string } | null;
    if (!taken) return candidate;
  }
}

/** A string as an ilike pattern that matches only itself, ignoring case. A
 *  YouTube handle such as @ericsrealm_ contains an underscore, which ilike
 *  would otherwise read as "any one character". */
const escapeLikePattern = (text: string): string => text.replace(/[\\%_]/g, "\\$&");

/** Returns the project id for a creator or a slug, creating the project if we
 *  have never seen it. A creator is looked up by feed URL first, because that
 *  is the key everything shares, and by slug second. Feed URLs are compared
 *  ignoring letter case, as the database's own functions do (migration 086).
 *  The same YouTube handle arrives as @DwarkeshPatel from a watch page and as
 *  @dwarkeshpatel from the Data API.
 *
 *  Two different creators can derive the same slug, such as a YouTube channel
 *  and a Substack that both go by the same handle. When the slug is taken by a
 *  project that already carries some other feed URL, that is a different
 *  creator, and the new one gets a suffixed slug rather than being merged into
 *  the wrong project. A slug-matched project with no feed URL yet is the same
 *  creator ingested before we tracked feeds, and learns its URL here.
 *
 *  A display name that arrives with a feed URL was read from that feed's
 *  listing and always wins on the project; one that arrives without only
 *  fills in a slug placeholder. See fillDisplayName. */
export async function resolveProjectId(params: {
  slug: string;
  displayName?: string;
  feedUrl?: string;
}): Promise<string> {
  const { slug, displayName, feedUrl } = params;
  const db = getSupabaseClient();

  if (feedUrl) {
    const byFeed = throwOnError(
      await db.from("everything_projects").select(PROJECT_COLUMNS).ilike("feed_url", escapeLikePattern(feedUrl)).maybeSingle(),
    ) as ProjectRow | null;
    if (byFeed) {
      await fillDisplayName(byFeed, displayName, "feed");
      return byFeed.id;
    }
  }

  const bySlug = throwOnError(
    await db.from("everything_projects").select(PROJECT_COLUMNS).eq("slug", slug).maybeSingle(),
  ) as ProjectRow | null;
  const sameCreator = bySlug && (!feedUrl || !bySlug.feed_url || bySlug.feed_url.toLowerCase() === feedUrl.toLowerCase());
  if (bySlug && sameCreator) {
    if (feedUrl && !bySlug.feed_url) {
      throwOnError(await db.from("everything_projects").update({ feed_url: feedUrl }).eq("id", bySlug.id));
      bySlug.feed_url = feedUrl;
    }
    await fillDisplayName(bySlug, displayName, feedUrl ? "feed" : "post");
    return bySlug.id;
  }

  const newSlug = bySlug ? await freeSlug(slug) : slug;
  return (
    throwOnError(
      await db
        .from("everything_projects")
        .insert({ slug: newSlug, name: displayName ?? newSlug, feed_url: feedUrl ?? null })
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
    await getSupabaseClient().from("everything_projects").select(PROJECT_COLUMNS).eq("id", projectId).maybeSingle(),
  ) as ProjectRow | null;
  if (project) await fillDisplayName(project, displayName, "post");
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
  published_time?: string; // The exact moment of publication, when the walk's listing gives one.
  requested_since?: string; // Set for a page a reader asked for, so it goes to the top of the list.
  demanded_at?: string; // Set for a page several readers opened (GOO-793), which ranks like a priority creator's post.
  checked_scope?: "page" | "paragraph"; // Left out it defaults to a whole-page check.
}

/** Inserts new items into the queue and returns how many were inserted. A URL we
 *  already have is ignored. Every row is padded to the same set of keys, because
 *  PostgREST rejects a bulk insert whose rows have differing keys. */
export async function enqueueItems(rows: EnqueueRow[]): Promise<number> {
  // A key left undefined would drop out of the JSON and break the padding.
  const defined = (row: EnqueueRow) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
  const padded = rows.map((r) => ({ title: null, full_text: null, published_at: null, published_time: null, requested_since: null, demanded_at: null, checked_scope: "page", ...defined(r) }));
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

/** Marks a post as requested, so it goes to the top of the list. A post that
 *  is requested already keeps the time of its oldest open request. */
export async function markItemRequested(id: string): Promise<void> {
  throwOnError(
    await getSupabaseClient().from("everything_items").update({ requested_since: new Date().toISOString() }).eq("id", id).is("requested_since", null),
  );
}

/** What a request needs to know about the item its page already has. */
export interface PageItemState {
  id: string;
  status: string;
  checked_scope: CheckedScope;
  first_checked_at: string | null;
}

/** Finds the item a page URL resolves to, whatever its status. A YouTube page is
 *  matched by its video id, because the stored URL forms vary. Any other URL is
 *  matched exactly, apart from a trailing slash. This mirrors the extension's
 *  fetchItemForUrl. */
export async function findItemForPageUrl(
  pageUrl: string,
): Promise<PageItemState | null> {
  const db = getSupabaseClient();
  const videoId = extractYoutubeVideoId(pageUrl);
  if (videoId) {
    // ilike reads an underscore in the video id as a wildcard, so this is only a
    // prefilter. Every row it returns is verified by comparing the id exactly.
    const rows = throwOnError(
      await db.from("everything_items").select("id, status, checked_scope, first_checked_at, url").ilike("url", `%${videoId}%`),
    ) as (PageItemState & { url: string })[];
    const hit = rows.find((r) => extractYoutubeVideoId(r.url) === videoId);
    return hit ? { id: hit.id, status: hit.status, checked_scope: hit.checked_scope, first_checked_at: hit.first_checked_at } : null;
  }
  const trimmed = pageUrl.replace(/\/$/, "");
  const rows = throwOnError(
    await db.from("everything_items").select("id, status, checked_scope, first_checked_at").in("url", [trimmed, `${trimmed}/`]).limit(1),
  ) as PageItemState[];
  return rows[0] ?? null;
}

/** Turns an existing item into a whole-page check and puts it back in the
 *  queue, as requested when a reader asked for it. The item's claims and notes are kept, and
 *  the worker redoes only the unfinished ones. full_text is always
 *  overwritten. Keeping a paragraph item's old text would make the worker
 *  re-check the same paragraph and then record it as a whole-page check. Null
 *  makes the worker fetch the page itself. */
export async function promoteItemToWholePage(id: string, fullText: string | null, options: { requested: boolean }): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .update({ checked_scope: "page", full_text: fullText, status: "queued", error: null })
      .eq("id", id),
  );
  if (options.requested) await markItemRequested(id);
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

/** Puts an item back in the queue, for example a checked page a reader asks
 *  about again. Its claims and notes are kept. */
export async function requeueItem(id: string): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_items").update({ status: "queued" }).eq("id", id));
}

/** An errored item that still has repeat attempts left and has rested long
 *  enough for the next one. `feed_url` is the feed of the item's creator, or
 *  null when its project follows no feed. */
export interface RetryableErrorItem {
  id: string;
  source: ItemSource;
  url: string;
  title: string | null;
  published_at: string | null;
  retries: number;
  feed_url: string | null;
}

/** How old an item may be and still get attempts beyond its listed ones
 *  because its source could not be reached. */
const SOURCE_DOWN_RETRY_DAYS = 7;

/** Returns the errored items that are due another attempt. Since the list
 *  (GOO-791) only a post the intake service could not read ends in error, so
 *  this is how a page that was down is read again. `waitHours[n]` is how long an item that has been retried n times
 *  waits after its last failure, so an item retried as often as the list is
 *  long is never returned. The wait spaces the attempts out. Without it a
 *  failure whose cause lasts a while, say a broken proxy or an exhausted API
 *  key, would burn every retry within minutes and the item would be dead
 *  again before the cause clears.
 *
 *  An item whose source could not be reached is returned beyond the list too,
 *  every time the list's last wait has passed, until the item is
 *  SOURCE_DOWN_RETRY_DAYS old. Such a failure says nothing about the page. On
 *  2026-11-17 the YouTube proxy ran out of traffic for more than 20 hours, and
 *  8 of the 20 videos reader demand had queued spent every attempt on it, so
 *  they would have stayed in error after the proxy came back.
 *
 *  Only a post the list can still show is retried: a requested post, or one
 *  whose list day is `listedFrom` or later. An older post is never listed
 *  again, so another attempt would only move it from error to queued. */
export async function fetchRetryableErrorItems(waitHours: readonly number[], listedFrom: string): Promise<RetryableErrorItem[]> {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
  const due = waitHours.map((hours, retries) => `and(retries.eq.${retries},processed_at.lt."${hoursAgo(hours)}")`);
  type Row = Omit<RetryableErrorItem, "feed_url"> & { everything_projects: { feed_url: string | null } | null };
  const errored = () =>
    getSupabaseClient()
      .from("everything_items")
      .select("id, source, url, title, published_at, retries, everything_projects(feed_url)")
      .eq("status", "error")
      .or(`requested_since.not.is.null,list_date.gte.${listedFrom}`);
  const rows = [
    ...(await fetchAllRows<Row>(() => errored().or(due.join(",")), "id", { label: "retryableErrorItems" })),
    ...(await fetchAllRows<Row>(
      () =>
        errored()
          .gte("retries", waitHours.length)
          .like("error", `%${SOURCE_UNREACHABLE_TEXT}%`)
          .lt("processed_at", hoursAgo(waitHours[waitHours.length - 1]!))
          .gte("created_at", hoursAgo(SOURCE_DOWN_RETRY_DAYS * 24)),
      "id",
      { label: "sourceDownErrorItems" },
    )),
  ];
  return rows.map(({ everything_projects, ...item }) => ({ ...item, feed_url: everything_projects?.feed_url ?? null }));
}

/** How one feed item's check ended: its source, and whether it failed. A post
 *  finished with a skip reason, such as a video without captions, counts as
 *  neither a failure nor a read. */
export interface ItemOutcome {
  source: string;
  outcome: "failed" | "read" | "skipped";
}

/** The outcomes of the items whose check ended since the given time. */
export async function fetchItemOutcomesSince(since: Date): Promise<ItemOutcome[]> {
  const rows = throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .select("source, status, skip_reason")
      .in("status", ["done", "error"])
      .gte("processed_at", since.toISOString()),
  ) as { source: string; status: "done" | "error"; skip_reason: string | null }[];
  return rows.map((r) => ({ source: r.source, outcome: r.status === "error" ? "failed" : r.skip_reason ? "skipped" : "read" }));
}

/** Puts an errored item back in the queue for a repeat attempt, and counts
 *  the attempt. The last error text stays on the row until the item finishes,
 *  so a waiting retry still shows why the item failed. */
export async function requeueErroredItem(item: RetryableErrorItem): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .update({ status: "queued", retries: item.retries + 1 })
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
  const claims = await fetchAllRows<ItemClaimRow & { created_at: string }>(
    () => getSupabaseClient()
      .from("everything_claims")
      .select("id, claim, judgement, context_quote, context_paragraph, image_urls, status, created_at")
      .eq("item_id", itemId),
    "id",
    { label: "itemClaims" },
  );
  return claims.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Whether the pipeline takes reader requests and whether it takes feed
 *  posts. The pipeline is the notewriter `pipeline` of API v1 (GOO-724). Its
 *  pace comes from the money pacing in pacing.ts, not from its interval. */
export async function pipelineSubscription(): Promise<{ requests: boolean; feed: boolean }> {
  const row = throwOnError(
    await getSupabaseClient().from("everything_notewriters").select("every_minutes, takes_reader_requests").eq("id", PIPELINE_NOTEWRITER).single(),
  ) as { every_minutes: number | null; takes_reader_requests: boolean };
  return { requests: row.takes_reader_requests, feed: row.every_minutes !== null };
}

/** Reserves the top requested post that no notewriter of the team holds or
 *  finished since the request, for the intake service. It takes reader
 *  requests for the pipeline, and must not take a feed post, which v1's
 *  next_post would hand out once one is due. Null when none waits. */
export async function reserveRequestedPost(notewriter: string): Promise<HandedOutPost | null> {
  return throwOnError(await getSupabaseClient().rpc("everything_take_requested_post", { p_notewriter: notewriter })) as HandedOutPost | null;
}

/** What changes with the clock alone (migration 184): open reservations past
 *  their deadline end as expired, and listed posts that turned 14 days old
 *  leave the list. */
export async function tidyList(): Promise<{ expired: number; closed: number }> {
  // A function with OUT parameters returns one row, which PostgREST sends as
  // a single object, not as an array.
  return throwOnError(await getSupabaseClient().rpc("notewriter_tidy_list")) as { expired: number; closed: number };
}

/** Sets every creator's place in the list: list_rank of everything_projects.
 *  Returns how many creators changed. */
export async function setListRanks(ranks: { feed_url: string; rank: number }[]): Promise<number> {
  return throwOnError(await getSupabaseClient().rpc("notewriter_set_list_ranks", { p_ranks: ranks })) as number;
}

/** Our own notewriters that are switched on. Slack hears of their silences,
 *  never of an outside notewriter's. */
export async function fetchWatchedNotewriters(): Promise<WatchedNotewriter[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_notewriters")
      .select("id, name, owner, last_seen_at, silence_warned_for")
      .eq("outside", false)
      .is("disabled_at", null),
  ) as WatchedNotewriter[];
}

export async function setSilenceWarnedFor(notewriter: string, warnedFor: Date | null): Promise<void> {
  throwOnError(
    await getSupabaseClient().from("everything_notewriters").update({ silence_warned_for: warnedFor?.toISOString() ?? null }).eq("id", notewriter),
  );
}

/** How many queued posts one pass of the intake service's preparer reads. */
const ITEMS_PREPARED_PER_PASS = 20;

/** Queued posts no notewriter can get yet: ones without stored text, and
 *  videos without their caption timings. Requested posts come first. */
export async function fetchItemsToPrepare(): Promise<EverythingItem[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .select(ITEM_COLUMNS)
      .eq("status", "queued")
      .or("full_text.is.null,and(source.eq.youtube,caption_cues.is.null)")
      .order("requested_since", { ascending: true, nullsFirst: false })
      .order("created_at")
      .limit(ITEMS_PREPARED_PER_PASS),
  ) as EverythingItem[];
}

export async function storeCaptionCues(id: string, cues: unknown[]): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_items").update({ caption_cues: cues }).eq("id", id));
}

export async function recordReadFailure(itemId: string, reason: string): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_read_failures").insert({ item_id: itemId, reason }));
}

/** What the usage pacing of the Claude note writer needs (usagePacing.ts):
 *  the usage readings of this host's notewriter and the posts it reserved over
 *  the window. Every assignment of migration 168 became a reservation with the
 *  same id (migration 184). */
export async function fetchUsageSnapshot(): Promise<UsageSnapshot> {
  const now = new Date();
  const since = new Date(now.getTime() - USAGE_WINDOW_HOURS * 3600_000).toISOString();
  const db = getSupabaseClient();
  const [readings, reserved] = await Promise.all([
    fetchAllRows<{ id: number; at: string; weekly: number; weekly_resets_at: string | null }>(
      () => db.from("everything_claude_usage").select("id, at, weekly, weekly_resets_at").eq("notewriter", CLAUDE_NOTEWRITER).gte("at", since),
      "id",
      { label: "claudeUsage" },
    ),
    db.from("everything_reservations").select("id", { count: "exact", head: true }).eq("notewriter_id", CLAUDE_NOTEWRITER).gte("started_at", since),
  ]);
  if (reserved.error) throw new Error(`Supabase: ${reserved.error.message}`);
  return {
    now,
    readings: readings
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((r) => ({ at: new Date(r.at), weekly: r.weekly, weeklyResetsAt: r.weekly_resets_at ? new Date(r.weekly_resets_at) : null })),
    postsTaken: reserved.count ?? 0,
  };
}

export async function fetchItem(id: string): Promise<EverythingItem> {
  return throwOnError(await getSupabaseClient().from("everything_items").select(ITEM_COLUMNS).eq("id", id).single()) as EverythingItem;
}

export async function updateItemMeta(
  id: string,
  meta: { title: string; published_at: string | null; full_text: string },
): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_items").update(meta).eq("id", id));
}

/** `skipReason` is why the item was finished without being checked, or null
 *  when it was checked. Either the intent gate declined it, or it is a video
 *  we cannot read ("no captions", "age-restricted"). It is always written, so
 *  an item the gate once declined and a reader later promoted to a whole-page
 *  check loses its stale reason. */
export async function markItemDone(id: string, skipReason: string | null): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .update({ status: "done", error: null, progress: null, skip_reason: skipReason, processed_at: new Date().toISOString() })
      .eq("id", id),
  );
}

/** Marks a post the pipeline is checking, which the reader's progress card
 *  shows and the feed pacing counts from (migration 096). */
export async function markItemProcessing(id: string): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_items").update({ status: "processing" }).eq("id", id));
}

export async function markItemError(id: string, error: string): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .update({ status: "error", error, progress: null, processed_at: new Date().toISOString() })
      .eq("id", id),
  );
}

/** How many claim rows one insert request carries. An item can hold hundreds
 *  of claims, and one request per chunk keeps each body and each returned id
 *  list well under the API's row cap. */
const CLAIM_INSERT_CHUNK_SIZE = 200;

/** Inserts the claim rows and returns their ids in input order. */
export async function insertClaims(rows: NewClaimRow[]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += CLAIM_INSERT_CHUNK_SIZE) {
    const inserted = throwOnError(
      await getSupabaseClient().from("everything_claims").insert(rows.slice(i, i + CLAIM_INSERT_CHUNK_SIZE)).select("id"),
    ) as { id: string }[];
    ids.push(...inserted.map((r) => r.id));
  }
  return ids;
}

export async function setClaimStatus(id: string, status: ClaimStatus, reason: string | null): Promise<void> {
  throwOnError(
    await getSupabaseClient().from("everything_claims").update({ status, status_reason: reason }).eq("id", id),
  );
}

/** The live stage of an item being worked, shown on the extension's progress
 *  card. Written at stage boundaries only, and cleared by the terminal writes,
 *  so a stale stage never survives an item. */
export type ItemProgress =
  | { stage: "extracting" }
  | { stage: "rating" }
  | { stage: "checking"; total: number }
  | { stage: "budget_exhausted" };

export async function setItemProgress(id: string, progress: ItemProgress | null): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_items").update({ progress }).eq("id", id));
}

/** Whom a pipeline cost was spent for: a reader who asked for a page or a
 *  passage, or the feed. The reader share has its own daily ceiling in
 *  spendCap.ts. */
export type SpendFor = "reader" | "feed";

/** One fact-check run of a claim. This is the everything pipeline's counterpart
 *  of a pipeline_runs row. */
export interface ClaimPipelineRun {
  claim_id: string | null;
  kind?: "check" | "extraction" | "rating" | "other";
  item_id?: string;
  bot_name: string;
  outcome: string;
  outcome_reason: string | null;
  final_stage: string | null;
  ab_test_picks: Record<string, string> | null;
  bot_config: Record<string, unknown> | null;
  logs: Record<string, unknown> | null;
  cost: number | null;
  work_priority: SpendFor;
}

/** We scrub NUL characters here, the same way pipeline_runs does. Model output
 *  can contain U+0000, media OCR especially, and Postgres rejects such a value
 *  with error 22P05. */
export async function insertClaimPipelineRun(run: ClaimPipelineRun): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_pipeline_runs").insert(stripNullChars(run)));
}

/** How each per-item stage is written down. Extraction and rating have a kind
 *  of their own. Smaller costs share the kind "other", and the outcome says what
 *  they were for (migration 104). */
const ITEM_RUN_ROW = {
  extraction: { kind: "extraction", outcome: "extracted" },
  rating: { kind: "rating", outcome: "rated" },
  capture_cleanup: { kind: "other", outcome: "capture_cleanup" },
} as const;

/** Records what one per-item stage cost, so the daily spend cap counts it.
 *  Extraction and rating each write one such row per item, and so does the
 *  cleanup of a reader request's captured text. Until these rows existed the
 *  cap silently undercounted by exactly that spend. */
export async function insertItemRun(
  itemId: string,
  stage: keyof typeof ITEM_RUN_ROW,
  costUsd: number | null,
  spendFor: SpendFor,
  logs: Record<string, unknown> | null = null,
): Promise<void> {
  throwOnError(
    await getSupabaseClient().from("everything_pipeline_runs").insert(
      stripNullChars({
        ...ITEM_RUN_ROW[stage],
        item_id: itemId,
        claim_id: null,
        cost: costUsd,
        work_priority: spendFor,
        logs,
      }),
    ),
  );
}

/** Returns the given claims that already have an AI note. An AI note is one with
 *  a null author_id, so a user's draft does not count. A resume uses this to
 *  spot a run that was killed between insertNote and setClaimStatus. Such a
 *  claim is finalized rather than rechecked, because rechecking it would insert
 *  a second note. */
export async function fetchClaimIdsWithAiNotes(claimIds: string[]): Promise<Set<string>> {
  const rows = await fetchInBatches<{ id: string; claim_id: string }>(
    (chunk) => getSupabaseClient().from("everything_notes").select("id, claim_id").is("author_id", null).in("claim_id", chunk),
    claimIds,
    "id",
    { label: "claimIdsWithAiNotes" },
  );
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
  /** The reader's own words on why the selected passage needs a note. */
  steer?: string | null;
  /** The creator's feed URL as the extension worked it out. Untrusted input:
   *  the consumer uses it only when it parses as a creator feed. */
  feed_url?: string | null;
}

export type NoteRequestStatus = "enqueued" | "done" | "skipped" | "error";

/** Marks every queued reader-requested item as waiting on the spent budget.
 *  The extension shows the marker as "today's budget is used up". The marker
 *  needs no clearing of its own: the first progress write of a real run
 *  overwrites it, and the terminal writes null it. */
export async function markRequestedQueueBudgetExhausted(): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_items")
      .update({ progress: { stage: "budget_exhausted" } })
      .eq("status", "queued")
      .not("requested_since", "is", null),
  );
}

/** How long the oldest unconsumed note request has waited, in seconds, or
 *  null when the inbox is empty. The Actions feed run asks this to notice a
 *  dead intake service: intake consumes requests within seconds, so an old
 *  pending request means nobody is listening. */
export async function oldestPendingRequestAgeSeconds(): Promise<number | null> {
  const row = throwOnError<{ created_at: string } | null>(
    await getSupabaseClient()
      .from("everything_note_requests")
      .select("created_at")
      .eq("status", "pending")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  );
  if (!row) return null;
  return Math.round((Date.now() - new Date(row.created_at).getTime()) / 1000);
}

/** The unconsumed note requests, oldest first. */
export async function fetchPendingNoteRequests(): Promise<NoteRequestRow[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_note_requests")
      .select("id, page_url, page_title, selection, page_text, steer, feed_url")
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

/** One creator's score, counted in the database over the visit rows that carry
 *  a reader hash (GOO-257). A row without a hash cannot be told apart from
 *  another person's, so it counts for nothing. */
export interface CreatorVisitScore {
  /** The creator's feed address, in one of the capitalisations it was recorded
   *  under. Creators are grouped case-insensitively in the database. */
  feed_url: string;
  /** The average number of different people per post, over the creator's
   *  LAST_POSTS_PER_CREATOR most recently visited posts. This is what the walk
   *  ranks by. */
  visitors_per_post: number;
  /** How many posts that average covers, at most LAST_POSTS_PER_CREATOR. */
  posts: number;
  /** Different people who opened anything of this creator. It only orders
   *  creators whose averages tie. */
  people: number;
}

/** A creator we already know: a project row carrying the feed we poll. A
 *  creator IS a project (migration 086), so this is where their slug and their
 *  priority window live. The slug is derived
 *  from the URL, with a suffix when two creators share a handle, so the URL is
 *  the reliable key and the slug is not. */
export interface CreatorProject {
  project_slug: string;
  feed_url: string;
  /** While this lies in the future the creator is walked ahead of creators that
   *  qualify only on visits. Null means they are walked only if readers visit
   *  them. */
  priority_until: string | null;
}

/** Every creator we have a project for, whether or not they hold priority right
 *  now. The ranking needs the whole set, not just the prioritised ones: a
 *  creator walked on visits alone still has to be recognised as their existing
 *  project, or their notes would land in a second one under a derived slug. */
export async function fetchCreatorProjects(): Promise<CreatorProject[]> {
  const rows = await fetchAllRows<{ slug: string; feed_url: string; priority_until: string | null }>(
    () => getSupabaseClient()
      .from("everything_projects")
      .select("id, slug, feed_url, priority_until")
      .not("feed_url", "is", null),
    "id",
    { label: "creatorProjects" },
  );
  return rows.map((r) => ({
    project_slug: r.slug,
    feed_url: r.feed_url,
    priority_until: r.priority_until,
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

/** One upload in a YouTube channel's stored listing. */
export interface StoredUpload {
  videoId: string;
  title: string;
  /** The publish day, YYYY-MM-DD. */
  publishedAt: string;
  /** The exact moment of publication. A listing stored before 2026-10-23
   *  has only the day. */
  publishedTime?: string;
  /** A premiere or stream that has not started, which cannot be checked yet. */
  upcoming: boolean;
}

/** What the walk knows about one YouTube feed (everything_youtube_channels,
 *  migration 107). notified_at is left out, because only the youtube-websub
 *  Edge Function writes it and the walk only reads it. */
export interface YoutubeChannelRow {
  feed_url: string;
  channel_id: string;
  title: string;
  uploads: StoredUpload[];
  listed_at: string | null;
  notified_at: string | null;
  subscribed_at: string | null;
}

export async function fetchYoutubeChannel(feedUrl: string): Promise<YoutubeChannelRow | null> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_youtube_channels")
      .select("feed_url, channel_id, title, uploads, listed_at, notified_at, subscribed_at")
      .eq("feed_url", feedUrl)
      .maybeSingle(),
  ) as YoutubeChannelRow | null;
}

/** When each stored channel was last listed, notified and subscribed, for
 *  cn-walk's check every minute of which channels are due. The uploads are
 *  left out, so the read stays small. */
export async function fetchYoutubeChannelStates(): Promise<Pick<YoutubeChannelRow, "feed_url" | "listed_at" | "notified_at" | "subscribed_at">[]> {
  return fetchAllRows<Pick<YoutubeChannelRow, "feed_url" | "listed_at" | "notified_at" | "subscribed_at">>(
    () => getSupabaseClient().from("everything_youtube_channels").select("feed_url, listed_at, notified_at, subscribed_at"),
    "feed_url",
    { label: "youtubeChannelStates" },
  );
}

/** Writes everything the walk owns on the row. notified_at is not written, so
 *  a notification that arrives while the walk lists the channel is kept. */
export async function saveYoutubeChannel(row: Omit<YoutubeChannelRow, "notified_at">): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("everything_youtube_channels")
      .upsert({
        feed_url: row.feed_url,
        channel_id: row.channel_id,
        title: row.title,
        uploads: row.uploads,
        listed_at: row.listed_at,
        subscribed_at: row.subscribed_at,
      }),
  );
}

/** Every visited creator's visit numbers over their LAST_POSTS_PER_CREATOR
 *  most recently visited posts. They are counted once a day and stored in the
 *  materialized view everything_creator_visits (migration 135), because
 *  counting them reads every visit row ever written. */
export async function fetchCreatorVisitScores(): Promise<CreatorVisitScore[]> {
  // One row per creator anyone visited, which passed 1,000 rows in September
  // 2026. feed_url is unique in the view, so the rows page by it.
  return fetchAllRows<CreatorVisitScore>(
    () => getSupabaseClient().from("everything_creator_visits").select("feed_url, visitors_per_post, posts, people"),
    "feed_url",
    { label: "creatorVisitScores" },
  );
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

/** The part of fetchCostSinceUsd that was spent on readers' requests
 *  (migration 114). */
export async function fetchReaderCostSinceUsd(since: Date): Promise<number> {
  const total = throwOnError(
    await getSupabaseClient().rpc("everything_reader_cost_since", { since: since.toISOString() }),
  ) as number | string | null;
  return Number(total ?? 0);
}

/** The pacing snapshot from everything_feed_pacing (migration 096): the
 *  database clock, today's spend, the mean cost of a finished feed post over
 *  the rule's window (or its fallback window when the recent one holds fewer
 *  than minPosts, and never from before its cutoff), and when the last
 *  feed-tier item started. One read, one
 *  clock, so the pacing rule never compares the runner's time with the database's. */
export async function fetchFeedPacing(rule: MeanCostRule): Promise<FeedPacingSnapshot> {
  const row = throwOnError(
    await getSupabaseClient()
      .rpc("everything_feed_pacing", {
        window_hours: rule.windowHours,
        min_posts: rule.minPosts,
        fallback_hours: rule.fallbackHours,
        not_before: rule.notBefore.toISOString(),
      })
      .single(),
  ) as {
    db_now: string;
    spent_today_usd: number | string | null;
    mean_post_cost_usd: number | string | null;
    sample_posts: number | string;
    sample_hours: number;
    last_feed_started_at: string | null;
  };
  return {
    dbNow: new Date(row.db_now),
    spentTodayUsd: Number(row.spent_today_usd ?? 0),
    meanPostCostUsd: row.mean_post_cost_usd === null ? null : Number(row.mean_post_cost_usd),
    samplePosts: Number(row.sample_posts),
    sampleHours: row.sample_hours,
    lastFeedStartedAt: row.last_feed_started_at ? new Date(row.last_feed_started_at) : null,
  };
}

/** Sets the alarm the database starts the next feed run on (migration 098).
 *  The reason is stored next to it so the schedule table explains itself. */
export async function setFeedAlarm(at: Date, reason: string): Promise<void> {
  throwOnError(await getSupabaseClient().rpc("everything_set_feed_alarm", { next_at: at.toISOString(), reason }));
}

/** A project whose picture is due for a refresh (migration 106). */
export interface AvatarDue {
  id: string;
  slug: string;
  feed_url: string;
}

/** Projects with a feed whose picture was never fetched or was last fetched
 *  before `olderThan`, never-fetched ones first, then the oldest attempt. */
export async function fetchProjectsDueForAvatar(olderThan: Date, limit: number): Promise<AvatarDue[]> {
  return throwOnError(
    await getSupabaseClient()
      .from("everything_projects")
      .select("id, slug, feed_url")
      .not("feed_url", "is", null)
      .or(`avatar_refreshed_at.is.null,avatar_refreshed_at.lt.${olderThan.toISOString()}`)
      .order("avatar_refreshed_at", { ascending: true, nullsFirst: true })
      .limit(limit),
  ) as AvatarDue[];
}

/** Records a refresh attempt at `attemptedAt`. A picture found replaces the
 *  stored one. A failed or empty fetch keeps whatever picture the project
 *  already had. */
export async function recordAvatarAttempt(projectId: string, avatarUrl: string | null, attemptedAt: Date): Promise<void> {
  const stamp = { avatar_refreshed_at: attemptedAt.toISOString() };
  throwOnError(await getSupabaseClient().from("everything_projects").update(avatarUrl ? { ...stamp, avatar_url: avatarUrl } : stamp).eq("id", projectId));
}

/** A page without an item that enough different readers opened in the last 7
 *  days (everything_demanded_pages, migration 183). */
export interface DemandedPage {
  page_url: string;
  feed_url: string | null;
  kind: "text" | "youtube";
  readers: number;
}

/** The pages reader demand would queue now, most readers first. A null bar
 *  leaves that kind out. */
export async function fetchDemandedPages(textReaders: number | null, youtubeReaders: number | null): Promise<DemandedPage[]> {
  return throwOnError(
    await getSupabaseClient().rpc("everything_demanded_pages", { p_text_readers: textReaders, p_youtube_readers: youtubeReaders }),
  ) as DemandedPage[];
}

/** One kind's row of everything_demand_report. */
export interface DemandReportRow {
  kind: "text" | "youtube";
  queued_24h: number;
  settled: number;
  checked: number;
  with_notes: number;
}

export async function fetchDemandReport(): Promise<DemandReportRow[]> {
  return throwOnError(await getSupabaseClient().rpc("everything_demand_report")) as DemandReportRow[];
}

/** Records that the demand rule took a page, so it never takes it again.
 *  `queued` is false for a page that already had an item. */
export async function recordDemandQueued(row: { page_url: string; kind: string; readers: number; queued: boolean }): Promise<void> {
  throwOnError(await getSupabaseClient().from("everything_demand_queued").insert(row));
}

