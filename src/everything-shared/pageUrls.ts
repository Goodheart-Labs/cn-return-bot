/** Pure URL helpers shared by the web app, the extension, and the everything
 *  pipeline. Nothing here touches the network or the Supabase client, so the
 *  pipeline can import this file without pulling in the browser-only client
 *  setup in supabase.ts. */

const TRACKING_PARAMS = ["fbclid", "gclid", "igshid", "si"];

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
