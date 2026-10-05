/** Pure URL helpers shared by the web app, the extension, and the everything
 *  pipeline. Nothing here touches the network or the Supabase client, so the
 *  pipeline can import this file without pulling in the browser-only client
 *  setup in supabase.ts. */

// Query parameters that only record how the reader arrived, never which page
// they see. Substack's logged-in reader adds lli=1 ("logged-in link") to every
// post link it shows, for example on a profile's Posts tab, next to its utm_
// parameters.
const TRACKING_PARAMS = ["fbclid", "gclid", "igshid", "si", "lli"];

/** Canonicalizes a page URL so it can be looked up in `everything_items.url`,
 *  with the page's canonical link passed in as a plain string. Callers that
 *  hold a Document use normalizePageUrl instead. The hash and any tracking
 *  parameters are dropped. */
export function canonicalizePageUrl(href: string, canonical: string | null): string {
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

/** Canonicalizes a page URL so it can be looked up in `everything_items.url`.
 *  The page's <link rel="canonical"> wins when there is one. A Substack item is
 *  stored under Substack's own canonical_url, and a newsletter on a custom domain
 *  only exposes that URL through the canonical tag. */
export function normalizePageUrl(href: string, doc?: Document): string {
  return canonicalizePageUrl(href, doc?.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null);
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

/** The form of a creator's feed address that two places must agree on: the
 *  extension hashes it into the reader hash on a visit row, and the pipeline
 *  groups creators by it. Trailing slashes and capitals are the two ways the
 *  same feed arrives written differently. If the two sides ever disagreed, one
 *  reader would silently be counted as two. */
export function normalizeFeedUrl(feedUrl: string): string {
  return feedUrl.replace(/\/+$/, "").toLowerCase();
}

// Builds the label of the "View on <domain>" link. The common hosts get a nicer
// name and every other host is shown by its bare hostname.
export function sourceLinkLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
  if (host === "x.com" || host === "twitter.com") return "X";
  if (host === "youtube.com" || host === "youtu.be") return "YouTube";
  return host;
}

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

export const COMMONNOTES_ORIGIN = "https://commonnotes.net";

/** Builds a deep link to a single note on the public site. The extension's
 *  Share action copies it, and the Slack announcements link to it. The site's
 *  addresses are described in everything-web/src/lib/routing.ts. */
export function noteShareUrl(projectSlug: string | null, noteId: string): string {
  const project = projectSlug ? `/${encodeURIComponent(projectSlug)}` : "";
  return `${COMMONNOTES_ORIGIN}/notes${project}?note=${encodeURIComponent(noteId)}`;
}
