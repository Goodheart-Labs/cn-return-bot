import { supabase } from "./supabase";
import type { ItemRow, NoteRow, NoteSourceRow } from "./types";

// Clients read whichever backend is deployed, which may be BEHIND the
// migrations this build assumes. Columns/tables that can be missing:
//   - migration 056: `everything_note_sources` table (old notes keep a `sources`
//     jsonb array of URLs on the note row instead)
//   - migration 057: `everything_claims.image_urls`
//   - migration 063: `everything_note_not_needed` (the list simply stays empty)
// Probe once and shape the query + normalize rows so callers render
// identically against the old or the new schema.
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

/** PostgREST select string for a note with its embedded claim + sources.
 *  `innerClaim` makes the claim join inner so the query can filter on
 *  claim columns (e.g. `.eq("claim.item_id", …)`). */
export function noteSelect(s: Schema, opts?: { innerClaim?: boolean }): string {
  const join = opts?.innerClaim ? "everything_claims!inner" : "everything_claims";
  const claim = `claim:${join}(${CLAIM_COLS}${s.hasImageUrls ? ", image_urls" : ""})`;
  const sources = s.hasNoteSources ? ", sources:everything_note_sources(url, quote, explanation, sort_order)" : "";
  return `*, ${claim}${sources}`;
}

/** Coerce a raw note row from either schema into NoteRow: sources always a
 *  NoteSourceRow[] (old jsonb URL array → quote-less rows), claim.image_urls
 *  always an array. */
export function normalizeNote(row: any, s: Schema): NoteRow {
  const sources: NoteSourceRow[] = s.hasNoteSources
    ? (row.sources ?? [])
    : (Array.isArray(row.sources) ? row.sources : []).map((url: string, i: number) => ({
        url, quote: null, explanation: null, sort_order: i,
      }));
  const claim = row.claim ? { ...row.claim, image_urls: row.claim.image_urls ?? [] } : row.claim;
  return { ...row, sources, claim };
}

/** One note by id, fully joined + normalized (e.g. refetch after a vote to
 *  pick up the trigger-computed counts). */
export async function fetchNote(id: string): Promise<NoteRow | null> {
  const schema = await detectSchema();
  const { data } = await supabase.from("everything_notes").select(noteSelect(schema)).eq("id", id).maybeSingle();
  return data ? normalizeNote(data, schema) : null;
}

// ---------------------------------------------------------------------------
// Page-scoped lookups (browser extension): resolve the current page to an
// everything_items row, then fetch just that item's notes.
// ---------------------------------------------------------------------------

const TRACKING_PARAMS = ["fbclid", "gclid", "igshid", "si"];

/** Canonicalize a page URL for the `everything_items.url` lookup: prefer the
 *  page's <link rel="canonical"> (Substack items store Substack's canonical_url,
 *  which custom-domain newsletters only expose via that tag), drop the hash and
 *  tracking params. */
export function normalizePageUrl(href: string, doc?: Document): string {
  const canonical = doc?.querySelector('link[rel="canonical"]')?.getAttribute("href");
  let url = new URL(href);
  if (canonical) {
    // SPAs (Substack) can leave the previous page's canonical tag in place
    // after a client-side navigation — trusting it then resolves the wrong
    // item (e.g. the homepage matching the last-read post). Only follow the
    // canonical while it still points at the current path; custom-domain
    // canonicals differ in host, not path, so they stay covered.
    const canonicalUrl = new URL(canonical, url);
    if (canonicalUrl.pathname.replace(/\/$/, "") === url.pathname.replace(/\/$/, "")) url = canonicalUrl;
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || TRACKING_PARAMS.includes(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

/** Substack's reader app shows posts under several apex-domain URL shapes
 *  (`/@author/p-<postid>`, `/home/post/p-<postid>`, inbox variants…) the DB
 *  has never seen; its <link rel=canonical> is self-referential, so the only
 *  mapping to the publication URL we store is the `canonical_url` field in
 *  the page's embedded JSON. Match any `/p-<id>` path segment — a false
 *  positive just fetches a page with no embedded canonical and falls back. */
export function isSubstackReaderUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return /^(www\.)?substack\.com$/.test(url.hostname) && /\/p-\d+(\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

/** The embedded `canonical_url` appears raw or JSON-escaped depending on
 *  where Substack serialized it; a URL contains neither `"` nor `\`. */
export function extractEmbeddedCanonical(html: string): string | null {
  return html.match(/canonical_url\\?"\s*:\s*\\?"(https?:[^"\\]+)/)?.[1] ?? null;
}

/** Resolve a reader URL to the publication post URL by fetching the page
 *  fresh (the DOM's embedded JSON goes stale on reader SPA navigation).
 *  Works from the popup too — host permission covers substack.com. */
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

/** ItemRow plus what the extension needs alongside it: the transcript/article
 *  body (write-note anchor check) and the project slug (share links). */
export type PageItem = ItemRow & { full_text: string | null; projectSlug: string | null };

const ITEM_COLS = "id, project_id, source, url, title, published_at, status, error, created_at, full_text";
const ITEM_SELECT = `${ITEM_COLS}, project:everything_projects(slug)`;

function toPageItem(row: any): PageItem {
  const { project, ...item } = row;
  return { ...item, projectSlug: project?.slug ?? null };
}

/** Resolve a page URL to its everything_items row, or null when the page
 *  isn't ingested. YouTube items store the URL as-enqueued (watch?v= or
 *  youtu.be), so match by video ID instead of exact URL — with no `source`
 *  filter: video items ingested through the old podcast pipeline carry
 *  source "podcast", and the ID re-verify below is the real matcher anyway. */
export async function fetchItemForUrl(pageUrl: string): Promise<PageItem | null> {
  const videoId = extractYoutubeVideoId(pageUrl);
  if (videoId) {
    // Video IDs are [A-Za-z0-9_-]; `_`/`-` make ilike over-match, so the
    // pattern only prefilters and each hit is re-verified by parsing its URL.
    const { data } = await supabase
      .from("everything_items")
      .select(ITEM_SELECT)
      .ilike("url", `%${videoId}%`);
    const hit = (data ?? []).find((r: any) => extractYoutubeVideoId(r.url) === videoId);
    return hit ? toPageItem(hit) : null;
  }
  const trimmed = pageUrl.replace(/\/$/, "");
  const { data } = await supabase
    .from("everything_items")
    .select(ITEM_SELECT)
    .in("url", [trimmed, `${trimmed}/`])
    .limit(1);
  return data?.[0] ? toPageItem(data[0]) : null;
}

/** All visible notes on one item, joined + normalized. */
export async function fetchNotesForItem(itemId: string): Promise<NoteRow[]> {
  const schema = await detectSchema();
  const { data } = await supabase
    .from("everything_notes")
    .select(noteSelect(schema, { innerClaim: true }))
    .eq("claim.item_id", itemId)
    .neq("status", "hidden");
  return ((data ?? []) as any[]).map((r) => normalizeNote(r, schema));
}
