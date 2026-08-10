import { supabase } from "./supabase";
import type { ItemRow, NoteRow, NoteSourceRow } from "./types";

// A client reads whichever backend happens to be deployed, and that backend can
// be older than the migrations this build assumes. These are the pieces that may
// be missing:
//   - migration 056 added the `everything_note_sources` table. Without it, a note
//     keeps a `sources` jsonb array of URLs on its own row instead.
//   - migration 057 added `everything_claims.image_urls`.
//   - migration 063 added `everything_note_not_needed`. Without it the list of
//     entries simply stays empty.
// We probe the schema once, then shape the query and normalize the rows it
// returns. Callers render the same way against the old schema and the new one.
const CLAIM_COLS = "id, item_id, claim, context_quote, context_paragraph, updated_quote, context_url, start_seconds, end_seconds";

export type Schema = { hasImageUrls: boolean; hasNoteSources: boolean; hasNnn: boolean };
let schemaProbe: Promise<Schema> | null = null;

export function detectSchema(): Promise<Schema> {
  schemaProbe ??= (async () => {
    const [img, ns, nnn] = await Promise.all([
      supabase.from("everything_claims").select("image_urls").limit(1),
      supabase.from("everything_note_sources").select("url").limit(1),
      supabase.from("everything_note_not_needed").select("id").limit(1),
    ]);
    return { hasImageUrls: !img.error, hasNoteSources: !ns.error, hasNnn: !nnn.error };
  })();
  return schemaProbe;
}

/** Builds the PostgREST select string for a note with its claim and its sources
 *  embedded. Setting `innerClaim` makes the claim join an inner join, which is
 *  what lets the query filter on a claim column such as `claim.item_id`. */
export function noteSelect(s: Schema, opts?: { innerClaim?: boolean }): string {
  const join = opts?.innerClaim ? "everything_claims!inner" : "everything_claims";
  const claim = `claim:${join}(${CLAIM_COLS}${s.hasImageUrls ? ", image_urls" : ""})`;
  const sources = s.hasNoteSources ? ", sources:everything_note_sources(url, quote, explanation, sort_order)" : "";
  return `*, ${claim}${sources}`;
}

/** Turns a raw note row from either schema into a NoteRow. `sources` always ends
 *  up as an array of NoteSourceRow. On the old schema each URL in the jsonb array
 *  becomes a row that carries no quote. `claim.image_urls` always ends up as an
 *  array too. */
export function normalizeNote(row: any, s: Schema): NoteRow {
  const sources: NoteSourceRow[] = s.hasNoteSources
    ? (row.sources ?? [])
    : (Array.isArray(row.sources) ? row.sources : []).map((url: string, i: number) => ({
        url, quote: null, explanation: null, sort_order: i,
      }));
  const claim = row.claim ? { ...row.claim, image_urls: row.claim.image_urls ?? [] } : row.claim;
  return { ...row, sources, claim };
}

/** Fetches one note by id, fully joined and normalized. Callers use it to refetch
 *  a note after a vote, so they pick up the counts the database trigger wrote. */
export async function fetchNote(id: string): Promise<NoteRow | null> {
  const schema = await detectSchema();
  const { data } = await supabase.from("everything_notes").select(noteSelect(schema)).eq("id", id).maybeSingle();
  return data ? normalizeNote(data, schema) : null;
}

// ---------------------------------------------------------------------------
// Page-scoped lookups, used by the browser extension. They resolve the current
// page to an everything_items row, then fetch just that item's notes.
// ---------------------------------------------------------------------------

const TRACKING_PARAMS = ["fbclid", "gclid", "igshid", "si"];

/** Canonicalizes a page URL so it can be looked up in `everything_items.url`.
 *  The page's <link rel="canonical"> wins when there is one. A Substack item is
 *  stored under Substack's own canonical_url, and a newsletter on a custom domain
 *  only exposes that URL through the canonical tag. The hash and any tracking
 *  parameters are dropped. */
export function normalizePageUrl(href: string, doc?: Document): string {
  const canonical = doc?.querySelector('link[rel="canonical"]')?.getAttribute("href");
  let url = new URL(href);
  if (canonical) {
    // Substack is a single-page app, and after a client-side navigation it can
    // leave the previous page's canonical tag in the DOM. Trusting that tag
    // resolves the wrong item, so the homepage would match the last post read.
    // We only follow the canonical while it still points at the current path.
    // A custom-domain canonical differs from the page URL in its host and not in
    // its path, so it still passes this check.
    const canonicalUrl = new URL(canonical, url);
    if (canonicalUrl.pathname.replace(/\/$/, "") === url.pathname.replace(/\/$/, "")) url = canonicalUrl;
  }
  url.hash = "";
  // We collect the keys with forEach rather than by iterating. A Firefox content
  // script sees DOM objects through Xray wrappers, and those do not support the
  // iterator protocol on URLSearchParams. Spreading `url.searchParams.keys()`
  // throws "not iterable" there, which killed the whole content script on
  // startup.
  const keys: string[] = [];
  url.searchParams.forEach((_value, key) => keys.push(key));
  for (const key of keys) {
    if (key.startsWith("utm_") || TRACKING_PARAMS.includes(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

/** Substack's reader app shows a post under several URL shapes on the apex
 *  domain, such as `/@author/p-<postid>`, `/home/post/p-<postid>` and the inbox
 *  variants. The database has never seen any of them. The reader page's
 *  <link rel=canonical> points at itself, so the only route back to the
 *  publication URL we store is the `canonical_url` field in the page's embedded
 *  JSON. We therefore match any `/p-<id>` path segment. A false positive costs
 *  nothing, because the fetched page then has no embedded canonical and the
 *  caller falls back. */
export function isSubstackReaderUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return /^(www\.)?substack\.com$/.test(url.hostname) && /\/p-\d+(\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

/** The embedded `canonical_url` appears either raw or JSON-escaped, depending on
 *  where Substack serialized it, so the pattern allows for both. A URL contains
 *  neither a double quote nor a backslash, so those characters end the match. */
export function extractEmbeddedCanonical(html: string): string | null {
  return html.match(/canonical_url\\?"\s*:\s*\\?"(https?:[^"\\]+)/)?.[1] ?? null;
}

/** Resolves a reader URL to the publication's own post URL by fetching the page
 *  again. A fresh fetch is needed because the reader is a single-page app, so the
 *  embedded JSON already in the DOM goes stale after a navigation.
 *  Extension callers must run this in the background script, through the
 *  cn-reader-canonical message. Substack redirects the reader URL of a
 *  logged-out visitor to the publication's domain, and only a fetch that holds
 *  the host permission may follow that cross-origin redirect. A content script,
 *  or any other context bound by CORS, gets null instead. */
export async function fetchReaderCanonical(href: string): Promise<string | null> {
  try {
    const html = await (await fetch(href, { credentials: "omit" })).text();
    return extractEmbeddedCanonical(html);
  } catch {
    return null;
  }
}

export function extractYoutubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.split("/")[1] || null;
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const v = u.searchParams.get("v");
    if (v) return v;
    return u.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** An ItemRow plus the two extra fields the extension needs. `full_text` is the
 *  transcript or article body, which the write-note flow searches to check its
 *  anchor. `projectSlug` is what share links are built from. */
export type PageItem = ItemRow & { full_text: string | null; projectSlug: string | null };

const ITEM_COLS = "id, project_id, source, url, title, published_at, status, error, created_at, full_text";
const ITEM_SELECT = `${ITEM_COLS}, project:everything_projects(slug)`;

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
  const videoId = extractYoutubeVideoId(pageUrl);
  if (videoId) {
    // A video ID may contain an underscore, and ilike reads an underscore as a
    // wildcard, so this pattern matches more rows than it should. It is only a
    // prefilter. Every row it returns is verified below by parsing that row's
    // URL and comparing the video ID exactly.
    const { data } = await supabase
      .from("everything_items")
      .select(ITEM_SELECT)
      .ilike("url", `%${videoId}%`);
    const hit = (data ?? []).find((r: any) => extractYoutubeVideoId(r.url) === videoId);
    return hit ? toPageItem(hit) : null;
  }
  const trimmed = pageUrl.replace(/\/$/, "");
  const { data, error } = await supabase
    .from("everything_items")
    .select(ITEM_SELECT)
    .in("url", [trimmed, `${trimmed}/`])
    .limit(1);
  if (error) console.warn(`[common-notes] item lookup failed: ${error.message}`);
  return data?.[0] ? toPageItem(data[0]) : null;
}

/** Returns the URL of every ingested page. This is the extension's coverage
 *  list. The extension caches it locally so a content script can decide on the
 *  user's own device whether the current page is one of ours. Browsing a page
 *  that has no notes must never reach our backend. Returns null when the query
 *  failed, so a caller does not mistake an outage for "we cover nothing". */
export async function fetchCoveredPageUrls(): Promise<string[] | null> {
  const { data, error } = await supabase.from("everything_items").select("url");
  if (error) return null;
  return (data ?? []).map((r: any) => r.url as string).filter((url) => !url.startsWith("local:"));
}

/** Returns the URL of every ingested page that has visible notes, or null when
 *  the query failed. Synthetic local documents, whose URL starts with `local:`,
 *  are left out. */
export async function fetchNotedPageUrls(): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("everything_notes")
    .select("claim:everything_claims!inner(item:everything_items!inner(url))")
    .neq("status", "hidden");
  if (error) return null;
  return [...new Set((data ?? []).map((r: any) => r.claim.item.url as string))]
    .filter((url) => !url.startsWith("local:"));
}

/** Picks a random ingested page that has visible notes. The popup's "Open random
 *  page" button goes there. */
export async function fetchRandomNotedPageUrl(): Promise<string | null> {
  const urls = (await fetchNotedPageUrls()) ?? [];
  return urls[Math.floor(Math.random() * urls.length)] ?? null;
}

/** Fetches every visible note on one item, joined and normalized. */
export async function fetchNotesForItem(itemId: string): Promise<NoteRow[]> {
  const schema = await detectSchema();
  const { data } = await supabase
    .from("everything_notes")
    .select(noteSelect(schema, { innerClaim: true }))
    .eq("claim.item_id", itemId)
    .neq("status", "hidden");
  return ((data ?? []) as any[]).map((r) => normalizeNote(r, schema));
}
