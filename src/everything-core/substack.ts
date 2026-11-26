/** How we tell which Substack publication a page belongs to. A publication's
 *  feed URL is its *.substack.com address, and that is how the pipeline and
 *  the visit counts name the creator. Three kinds of address reach us:
 *
 *  - A post on the publication's own subdomain, such as
 *    thezvi.substack.com/p/…. The address names the publication.
 *  - A post on a custom domain, such as jasmi.news/p/…. The address names no
 *    publication, but every page on the domain embeds the publication's data
 *    (publicationInPreloads).
 *  - A post in Substack's reader app on substack.com, such as
 *    substack.com/home/post/p-<id>. The address names only the post's
 *    number. Fetched without cookies it redirects to the post's own address
 *    (fetchReaderCanonical), which then falls under one of the two cases
 *    above. The reader page itself does not help, because its embedded data
 *    describes the logged-in reader.
 *
 *  The fetches here must run where CORS does not apply. In the extension that
 *  is the background script. A content script may neither follow the
 *  cross-origin redirect nor read the response. */
import { fetchWithRetries } from "./retry";

export interface SubstackPublication {
  subdomain: string;
  name: string;
}

export const substackFeedUrl = (subdomain: string) => `https://${subdomain.toLowerCase()}.substack.com`;

const PUBLICATION_HOST = /^([\w-]+)\.substack\.com$/i;
const SUBDOMAIN = /^[\w-]+$/;

/** The publication of an address on a *.substack.com subdomain, or null for
 *  any other host. www.substack.com and substack.com are the reader app, not
 *  a publication. */
export function substackSubdomainOfUrl(url: string): string | null {
  try {
    const subdomain = new URL(url).hostname.match(PUBLICATION_HOST)?.[1]?.toLowerCase();
    return subdomain && subdomain !== "www" ? subdomain : null;
  } catch {
    return null;
  }
}

/** Reads the publication out of the text of a Substack page's
 *  `<script type="application/json" id="preloads-json">` tag, where Substack
 *  keeps the page's data. Its `pub` object is the publication the page
 *  belongs to. Null for text that is not such data, for example another
 *  site's tag with the same id.
 *
 *  Until about 2026-10-16 Substack put this data into an inline script that
 *  assigned `window._preloads`, as an escaped string. It then moved it into
 *  the JSON tag, and newsletters on their own domain stopped being recognised
 *  for a month (GOO-774). On 2026-11-26 the posts of 17 custom domains all
 *  had the tag. */
export function publicationInPreloads(preloads: string | null | undefined): SubstackPublication | null {
  if (!preloads) return null;
  let pub: { subdomain?: unknown; name?: unknown } | undefined;
  try {
    pub = JSON.parse(preloads)?.pub;
  } catch {
    return null;
  }
  if (typeof pub?.subdomain !== "string" || !SUBDOMAIN.test(pub.subdomain)) return null;
  const subdomain = pub.subdomain.toLowerCase();
  const name = typeof pub.name === "string" ? pub.name.trim() : "";
  return { subdomain, name: name || subdomain };
}

/** The same, read from a whole page's HTML. */
export function publicationInPageHtml(html: string): SubstackPublication | null {
  return publicationInPreloads(html.match(/<script[^>]*\bid="preloads-json"[^>]*>([\s\S]*?)<\/script>/)?.[1]);
}

/** The publication of a Substack page on a custom domain, read from the page
 *  fetched without cookies. */
export async function fetchPagePublication(pageUrl: string): Promise<SubstackPublication | null> {
  try {
    return publicationInPageHtml(await (await fetchWithRetries(pageUrl, { credentials: "omit" })).text());
  } catch {
    return null;
  }
}

/** The numeric post id in a URL of Substack's reader app, or null for any
 *  other URL. The reader shows a post under several URL shapes on the apex
 *  domain: `/@author/p-<id>`, `/home/post/p-<id>` and `/inbox/post/<id>`, the
 *  last one when a logged-in reader opens a post from their inbox. The
 *  database has never seen any of them, so a caller resolves them with
 *  fetchReaderCanonical. A false positive costs nothing, because the fetched
 *  page then has no embedded canonical and the caller falls back. */
export function substackReaderPostId(href: string): string | null {
  try {
    const url = new URL(href);
    if (!/^(www\.)?substack\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/\/(?:p-|inbox\/post\/)(\d+)(\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The embedded `canonical_url` appears either raw or JSON-escaped, depending on
 *  where Substack serialized it, so the pattern allows for both. A URL contains
 *  neither a double quote nor a backslash, so those characters end the match. */
function extractEmbeddedCanonical(html: string): string | null {
  return html.match(/canonical_url\\?"\s*:\s*\\?"(https?:[^"\\]+)/)?.[1] ?? null;
}

/** Resolves a reader URL to the post's own URL by fetching it without
 *  cookies. Every reader URL shape answered with a redirect to the post's own
 *  address on 2026-11-26, so the redirect target is the answer and the body is
 *  never downloaded. A reader URL that answers on substack.com itself is
 *  answered by the canonical_url in the page's embedded JSON. A fresh fetch is
 *  needed even on the reader page itself, because the reader is a single-page
 *  app and the JSON already in the DOM goes stale after a navigation. */
export async function fetchReaderCanonical(href: string): Promise<string | null> {
  try {
    const res = await fetchWithRetries(href, { credentials: "omit" });
    if (new URL(res.url).hostname !== new URL(href).hostname) {
      void res.body?.cancel();
      return res.url;
    }
    return extractEmbeddedCanonical(await res.text());
  } catch {
    return null;
  }
}
