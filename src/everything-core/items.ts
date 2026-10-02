import { noteStatus } from "./noteScore";
import { extractYoutubeVideoId } from "./pageUrls";
import { WEB_PROJECT_SLUG } from "./projects";
import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";
import type { FeedItemRow, ItemRow } from "./types";

/* An item is one post, video or page: a row of everything_items. */

/** One project's items, with the columns the website renders. The body text in
 *  particular is the largest column we have, and the website never shows it. */
export async function fetchProjectItems(projectId: string): Promise<FeedItemRow[]> {
  return fetchAllRows<FeedItemRow>(
    () => supabase.from("everything_items").select("id, project_id, url, title, published_at, created_at").eq("project_id", projectId),
    "id",
    { label: "projectItems" },
  );
}

/** An ItemRow plus the two extra fields the extension needs. `full_text` is the
 *  transcript or article body, which the write-note flow searches to check its
 *  anchor. `projectSlug` is what share links are built from. */
export type PageItem = ItemRow & { full_text: string | null; projectSlug: string | null };

const PAGE_ITEM_SELECT =
  "id, project_id, source, url, title, published_at, status, error, created_at, full_text, checked_scope, project:everything_projects(slug)";

/** Whether the pipeline has read this page in full. Only such a page refuses a
 *  new "check this page" request. An item that exists because a reader wrote
 *  a note, or because one paragraph was checked, is not a checked page. */
export function isWholePageChecked(item: Pick<ItemRow, "status" | "checked_scope"> | null): boolean {
  return item?.status === "done" && item.checked_scope === "page";
}

/** Resolves a page URL to its everything_items row. Returns null when the page
 *  has never been ingested, and throws when the lookup itself failed. Treating
 *  an outage as an unchecked page would tell the reader we never checked a
 *  page we did, and offer to check it again.
 *
 *  A YouTube item stores the URL exactly as it was enqueued, which may be a
 *  watch?v= link or a youtu.be link, so we match on the video ID rather than on
 *  the whole URL. There is no filter on `source`, because videos ingested
 *  through the old podcast pipeline carry the source "podcast", and the video
 *  ID check below is the real matcher anyway. */
export async function fetchItemForUrl(pageUrl: string): Promise<PageItem | null> {
  const videoId = extractYoutubeVideoId(pageUrl);
  const trimmed = pageUrl.replace(/\/$/, "");
  // A video ID may contain an underscore, and ilike reads an underscore as a
  // wildcard, so the video pattern matches more rows than it should. It is
  // only a prefilter. Every row it returns is checked below by parsing that
  // row's URL and comparing the video ID exactly.
  const query = supabase.from("everything_items").select(PAGE_ITEM_SELECT);
  const { data, error } = videoId
    ? await query.ilike("url", `%${videoId}%`)
    : await query.in("url", [trimmed, `${trimmed}/`]).limit(1);
  if (error) throw new Error(`item lookup failed: ${error.message}`);
  const hit = videoId ? data.find((row) => extractYoutubeVideoId(row.url) === videoId) : data[0];
  if (!hit) return null;
  const { project, ...item } = hit;
  return { ...(item as ItemRow & { full_text: string | null }), projectSlug: project?.slug ?? null };
}

/** The extension's coverage lists: every ingested page, and the subset the
 *  pipeline has read in full. The second list is what lets a listing badge say
 *  "we checked this and found nothing" for a page that has no notes. */
export interface CoveredPages {
  all: string[];
  wholePageChecked: string[];
}

/** Returns the URL of every ingested page. This is the extension's coverage
 *  list. The extension caches it locally so a content script can decide on the
 *  user's own device whether the current page is one of ours. Browsing a page
 *  that has no notes must never reach our backend. Returns null when the query
 *  failed, so a caller does not mistake an outage for "we cover nothing". */
export async function fetchCoveredPageUrls(): Promise<CoveredPages | null> {
  let allRows: Pick<ItemRow, "id" | "url" | "status" | "checked_scope">[];
  try {
    allRows = await fetchAllRows(() => supabase.from("everything_items").select("id, url, status, checked_scope"), "id", { label: "coveredPages" });
  } catch {
    return null;
  }
  const rows = allRows.filter((r) => !r.url.startsWith("local:"));
  return {
    all: rows.map((r) => r.url),
    wholePageChecked: rows.filter(isWholePageChecked).map((r) => r.url),
  };
}

/** How many notes of each rating status each ingested page has, keyed by the
 *  item's URL. The extension caches this next to the coverage list; its listing
 *  badges and count cards sum whichever statuses the user's note filters show.
 *  Synthetic local documents, whose URL starts with `local:`, are left out.
 *  Returns null when the query failed, so a caller does not mistake an outage
 *  for "nothing has notes". */
export type PageNoteStatusCounts = { helpful: number; needsRatings: number; notHelpful: number };

type NoteWithPageUrl = {
  id: string;
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  author_id: string | null;
  claim: { item: { url: string } };
};

export async function fetchNotedPageCounts(): Promise<Record<string, PageNoteStatusCounts> | null> {
  let notes: NoteWithPageUrl[];
  try {
    notes = await fetchAllRows(
      () => supabase
        .from("everything_notes")
        .select("id, helpful_count, somewhat_helpful_count, not_helpful_count, author_id, claim:everything_claims!inner(item:everything_items!inner(url))")
        .neq("status", "hidden"),
      "id",
      { label: "notedPageCounts" },
    );
  } catch {
    return null;
  }
  const counts: Record<string, PageNoteStatusCounts> = {};
  for (const row of notes) {
    const url = row.claim.item.url;
    if (url.startsWith("local:")) continue;
    const page = (counts[url] ??= { helpful: 0, needsRatings: 0, notHelpful: 0 });
    const status = noteStatus(row);
    if (status === "helpful") page.helpful += 1;
    else if (status === "needs_ratings") page.needsRatings += 1;
    else page.notHelpful += 1;
  }
  return counts;
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

/** The project a page's new item goes under: its creator's when the caller
 *  knows the creator, otherwise the catch-all "Around the web". A creator we
 *  have never met gets a project here, without priority (migration 111). */
async function projectIdForPage(creatorFeedUrl: string | null | undefined): Promise<string> {
  if (creatorFeedUrl) {
    const { data, error } = await supabase.rpc("everything_creator_project", { creator_feed_url: creatorFeedUrl });
    if (error) throw new Error(`creator project lookup failed: ${error.message}`);
    return data;
  }
  const { data: project } = await supabase.from("everything_projects").select("id").eq("slug", WEB_PROJECT_SLUG).maybeSingle();
  if (!project) throw new Error("the 'web' project is missing. Run migration 068");
  return project.id;
}

/** Finds or creates the everything_items row for any web page, and returns its
 *  id. The write-anywhere flow needs this first, because a note hangs off a
 *  claim and a claim hangs off an item. Row level security only lets a client
 *  insert rows with source='web' (migrations 068 and 081). `creatorFeedUrl` is
 *  the feed of the page's creator when the caller could tell, and decides the
 *  project. The `url` column is unique, so when two clients race, the loser
 *  simply reads the winner's row. */
export async function ensureWebItem(params: { url: string; title: string; creatorFeedUrl?: string | null }): Promise<string> {
  const url = params.url.replace(/\/$/, "");
  const existing = await supabase.from("everything_items").select("id").in("url", [url, `${url}/`]).limit(1);
  if (existing.data?.[0]) return existing.data[0].id;

  const projectId = await projectIdForPage(params.creatorFeedUrl);
  const inserted = await supabase
    .from("everything_items")
    .insert({ project_id: projectId, source: "web", url, title: params.title || null, status: "done" })
    .select("id")
    .single();
  if (inserted.data) return inserted.data.id;
  if (inserted.error?.code === POSTGRES_UNIQUE_VIOLATION) {
    const winner = await supabase.from("everything_items").select("id").eq("url", url).maybeSingle();
    if (winner.data) return winner.data.id;
  }
  throw new Error(inserted.error?.message ?? "could not create the page item");
}
