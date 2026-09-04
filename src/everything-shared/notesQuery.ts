import { noteStatus } from "./noteScore";
import { extractEmbeddedCanonical, extractYoutubeVideoId } from "./pageUrls";
import { supabase } from "./supabase";
import type { ItemRow, NoteRow, NoteSourceDetail, NoteSourceRow } from "./types";

// A client reads whichever backend happens to be deployed, and that backend can
// be older than the migrations this build assumes. These are the pieces that may
// be missing:
//   - migration 056 added the `everything_note_sources` table. Without it, a note
//     keeps a `sources` jsonb array of URLs on its own row instead.
//   - migration 057 added `everything_claims.image_urls`.
//   - migration 063 added `everything_note_not_needed`. Without it the list of
//     entries simply stays empty.
//   - migration 081 added `everything_items.checked_scope`. Without it, "is
//     this page fully checked" falls back to the item being done at all.
// We probe the schema once, then shape the query and normalize the rows it
// returns. Callers render the same way against the old schema and the new one.
const CLAIM_COLS = "id, item_id, claim, context_quote, context_paragraph, updated_quote, context_url, start_seconds, end_seconds";

export type Schema = { hasImageUrls: boolean; hasNoteSources: boolean; hasNnn: boolean; hasCheckedScope: boolean };
let schemaProbe: Promise<Schema> | null = null;

export function detectSchema(): Promise<Schema> {
  schemaProbe ??= (async () => {
    const [img, ns, nnn, scope] = await Promise.all([
      supabase.from("everything_claims").select("image_urls").limit(1),
      supabase.from("everything_note_sources").select("url").limit(1),
      supabase.from("everything_note_not_needed").select("id").limit(1),
      supabase.from("everything_items").select("checked_scope").limit(1),
    ]);
    return { hasImageUrls: !img.error, hasNoteSources: !ns.error, hasNnn: !nnn.error, hasCheckedScope: !scope.error };
  })();
  return schemaProbe;
}

/** Builds the PostgREST select string for a note with its claim and its sources
 *  embedded. Setting `innerClaim` makes the claim join an inner join, which is
 *  what lets the query filter on a claim column such as `claim.item_id`.
 *
 *  Only the source URLs are read, because the URLs are what the note text
 *  renders. The quote and the explanation of each source are much larger and
 *  they sit behind the "Show source details" button, so they are fetched by
 *  fetchNoteSourceDetails when a reader opens that. The button still has to know
 *  whether there is anything to show, and that is what the second, aliased embed
 *  of the same table is for: noteQuery filters it down to the sources that carry
 *  a quote, so its length answers the question without reading a single quote. */
function noteSelect(s: Schema, opts?: { innerClaim?: boolean; projectScoped?: boolean }): string {
  const join = opts?.innerClaim ? "everything_claims!inner" : "everything_claims";
  // Filtering on the project means reaching through the claim to its item, so
  // that item has to be embedded for PostgREST to accept `claim.item.project_id`
  // as a filter. Only the join column is read.
  const item = opts?.projectScoped ? ", item:everything_items!inner(project_id)" : "";
  const claim = `claim:${join}(${CLAIM_COLS}${s.hasImageUrls ? ", image_urls" : ""}${item})`;
  const sources = s.hasNoteSources
    ? ", sources:everything_note_sources(url, sort_order), detailed:everything_note_sources(sort_order)"
    : "";
  return `*, ${claim}${sources}`;
}

/** The query every note fetch starts from. It applies the select above and the
 *  one filter that select depends on, so no caller has to know how the
 *  source-details flag is built. Callers add their own filters and await it. */
export function noteQuery(s: Schema, opts?: { innerClaim?: boolean; projectScoped?: boolean }) {
  const q = supabase.from("everything_notes").select(noteSelect(s, opts));
  return s.hasNoteSources ? q.not("detailed.quote", "is", null) : q;
}

/** Turns a raw note row from either schema into a NoteRow. `sources` always ends
 *  up as an array of NoteSourceRow, and `has_source_details` says whether the
 *  reveal has anything in it. On the old schema the note's own jsonb column
 *  holds bare URLs, which carry no quotes, so the reveal is always empty there.
 *  `claim.image_urls` always ends up as an array too. */
export function normalizeNote(row: any, s: Schema): NoteRow {
  const { detailed, ...note } = row;
  const sources: NoteSourceRow[] = s.hasNoteSources
    ? (row.sources ?? [])
    : (Array.isArray(row.sources) ? row.sources : []).map((url: string, i: number) => ({ url, sort_order: i }));
  const claim = row.claim ? { ...row.claim, image_urls: row.claim.image_urls ?? [] } : row.claim;
  return { ...note, sources, claim, has_source_details: (detailed ?? []).length > 0 };
}

/** Fetches one note by id, fully joined and normalized. Callers use it to refetch
 *  a note after a vote, so they pick up the counts the database trigger wrote. */
export async function fetchNote(id: string): Promise<NoteRow | null> {
  const schema = await detectSchema();
  const { data } = await noteQuery(schema).eq("id", id).maybeSingle();
  return data ? normalizeNote(data, schema) : null;
}

/** The quote and the explanation behind one note's "Show source details"
 *  reveal. A source with no quote has no body to show, so it is left out here
 *  the same way the reveal leaves it out. This runs when a reader opens the
 *  reveal, which is why the feed can load without any of this text. */
export async function fetchNoteSourceDetails(noteId: string): Promise<NoteSourceDetail[]> {
  const { data } = await supabase
    .from("everything_note_sources")
    .select("url, quote, explanation, sort_order")
    .eq("note_id", noteId)
    .not("quote", "is", null)
    .order("sort_order");
  return (data ?? []) as NoteSourceDetail[];
}

// ---------------------------------------------------------------------------
// Page-scoped lookups, used by the browser extension. They resolve the current
// page to an everything_items row, then fetch just that item's notes. The pure
// URL helpers they build on live in pageUrls.ts.
// ---------------------------------------------------------------------------

/** Resolves a reader URL to the publication's own post URL by fetching it
 *  logged out. A home-feed link (substack.com/home/post/p-<id>) answers with a
 *  redirect to the publication's domain, so the redirect target is the answer
 *  and the body is never downloaded. A profile link (substack.com/@author/p-<id>)
 *  answers 200 on substack.com itself, so there the answer is the canonical_url
 *  in the page's embedded JSON. A fresh fetch is needed even on the reader page
 *  itself, because the reader is a single-page app and the JSON already in the
 *  DOM goes stale after a navigation. Extension callers must run this in the
 *  background script, through the cn-reader-canonical message. A content
 *  script, or any other context bound by CORS, may neither follow the
 *  cross-origin redirect nor read the response, and gets null instead. */
export async function fetchReaderCanonical(href: string): Promise<string | null> {
  try {
    const res = await fetch(href, { credentials: "omit" });
    if (new URL(res.url).hostname !== new URL(href).hostname) {
      void res.body?.cancel();
      return res.url;
    }
    return extractEmbeddedCanonical(await res.text());
  } catch {
    return null;
  }
}

/** An ItemRow plus the two extra fields the extension needs. `full_text` is the
 *  transcript or article body, which the write-note flow searches to check its
 *  anchor. `projectSlug` is what share links are built from. */
export type PageItem = ItemRow & { full_text: string | null; projectSlug: string | null };

const ITEM_COLS = "id, project_id, source, url, title, published_at, status, error, created_at, full_text";
// Selecting a column an old backend does not have fails the whole query, so
// checked_scope only joins the select once the probe confirmed it exists.
const itemSelect = (s: Schema) =>
  `${ITEM_COLS}${s.hasCheckedScope ? ", checked_scope" : ""}, project:everything_projects(slug)`;

/** Whether this page has been read in full by the pipeline. Only such a page
 *  refuses a new "check this page" request. An item that exists because a
 *  reader wrote a note, or because one paragraph was checked, is not a checked
 *  page. Against a backend that predates migration 081 the scope is undefined,
 *  and the rule falls back to what it used to be: done means checked. */
export function isWholePageChecked(item: Pick<ItemRow, "status" | "checked_scope"> | null): boolean {
  if (!item) return false;
  if (item.status !== "done") return false;
  return item.checked_scope === undefined || item.checked_scope === "page";
}

function toPageItem(row: any): PageItem {
  const { project, ...item } = row;
  return { ...item, projectSlug: project?.slug ?? null };
}

/** Resolves a page URL to its everything_items row. Returns null when the page
 *  has never been ingested. A YouTube item stores the URL exactly as it was
 *  enqueued, which may be a watch?v= link or a youtu.be link, so we match on the
 *  video ID rather than on the whole URL. There is no filter on `source`, because
 *  videos ingested through the old podcast pipeline carry the source "podcast",
 *  and the video ID check below is the real matcher anyway. */
export async function fetchItemForUrl(pageUrl: string): Promise<PageItem | null> {
  const select = itemSelect(await detectSchema());
  const videoId = extractYoutubeVideoId(pageUrl);
  if (videoId) {
    // A video ID may contain an underscore, and ilike reads an underscore as a
    // wildcard, so this pattern matches more rows than it should. It is only a
    // prefilter. Every row it returns is verified below by parsing that row's
    // URL and comparing the video ID exactly.
    const { data, error } = await supabase
      .from("everything_items")
      .select(select)
      .ilike("url", `%${videoId}%`);
    if (error) throw new Error(`item lookup failed: ${error.message}`);
    const hit = (data ?? []).find((r: any) => extractYoutubeVideoId(r.url) === videoId);
    return hit ? toPageItem(hit) : null;
  }
  const trimmed = pageUrl.replace(/\/$/, "");
  const { data, error } = await supabase
    .from("everything_items")
    .select(select)
    .in("url", [trimmed, `${trimmed}/`])
    .limit(1);
  // A failed lookup must throw rather than pass as "no item". Treating an
  // outage as an unchecked page would tell the reader we never checked a page
  // we did, and offer to check it again.
  if (error) throw new Error(`item lookup failed: ${error.message}`);
  return data?.[0] ? toPageItem(data[0]) : null;
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
  const s = await detectSchema();
  const { data, error } = await supabase
    .from("everything_items")
    .select(`url, status${s.hasCheckedScope ? ", checked_scope" : ""}`);
  if (error) return null;
  const rows = (data ?? []).filter((r: any) => !(r.url as string).startsWith("local:"));
  return {
    all: rows.map((r: any) => r.url as string),
    wholePageChecked: rows.filter((r: any) => isWholePageChecked(r)).map((r: any) => r.url as string),
  };
}

/** Returns the feed URL of every creator whose priority window is open right
 *  now. The extension caches it next to the coverage list, and the button
 *  surfaces read it to say "we're already checking this author" instead of
 *  offering the press again. A row-level policy hides creators whose window has
 *  lapsed, so this is exactly the live set. Returns null when the query failed,
 *  so a caller does not mistake an outage for "nobody is prioritised". */
export async function fetchPrioritizedCreatorUrls(): Promise<string[] | null> {
  const { data, error } = await supabase.from("everything_projects").select("feed_url").not("feed_url", "is", null);
  if (error) return null;
  return (data ?? []).map((r: any) => r.feed_url as string);
}

/** How many notes of each rating status each ingested page has, keyed by the
 *  item's URL. The extension caches this next to the coverage list; its listing
 *  badges and count cards sum whichever statuses the user's note filters show.
 *  Synthetic local documents, whose URL starts with `local:`, are left out.
 *  Returns null when the query failed, so a caller does not mistake an outage
 *  for "nothing has notes". */
export type PageNoteStatusCounts = { helpful: number; needsRatings: number; notHelpful: number };

export async function fetchNotedPageCounts(): Promise<Record<string, PageNoteStatusCounts> | null> {
  const { data, error } = await supabase
    .from("everything_notes")
    .select("helpful_count, somewhat_helpful_count, not_helpful_count, author_id, claim:everything_claims!inner(item:everything_items!inner(url))")
    .neq("status", "hidden");
  if (error) return null;
  const counts: Record<string, PageNoteStatusCounts> = {};
  for (const row of (data ?? []) as any[]) {
    const url = row.claim.item.url as string;
    if (url.startsWith("local:")) continue;
    const page = (counts[url] ??= { helpful: 0, needsRatings: 0, notHelpful: 0 });
    const status = noteStatus(row);
    if (status === "helpful") page.helpful += 1;
    else if (status === "needs_ratings") page.needsRatings += 1;
    else page.notHelpful += 1;
  }
  return counts;
}

/** Fetches every visible note on one item, joined and normalized. Returns
 *  null when the query failed, so a caller does not mistake an outage for a
 *  page without notes and announce "found nothing to note". */
export async function fetchNotesForItem(itemId: string): Promise<NoteRow[] | null> {
  const schema = await detectSchema();
  const { data, error } = await noteQuery(schema, { innerClaim: true })
    .eq("claim.item_id", itemId)
    .neq("status", "hidden");
  if (error) {
    console.warn(`[common-notes] notes fetch failed: ${error.message}`);
    return null;
  }
  return ((data ?? []) as any[]).map((r) => normalizeNote(r, schema));
}
