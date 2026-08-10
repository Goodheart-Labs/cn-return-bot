/**
 * Substack ingestion. Nothing here scrapes a rendered page. We read Substack's
 * public JSON API and its RSS feed:
 *   - substack.com/api/v1/user/<handle>/public_profile   → the publication subdomain
 *   - <sub>.substack.com/api/v1/archive?sort=new&limit=N → the latest posts
 *   - <sub>.substack.com/api/v1/posts/<slug>             → a free post's full body_html
 *   - <sub>.substack.com/feed                            → the latest posts with their bodies
 */

import { decodeHtmlEntities } from "../../pipeline/utils/html";
import type { FetchedContent } from "../types";

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** Reads the handle out of a profile URL, so "https://substack.com/@garymarcus/posts"
 *  gives "garymarcus". A URL that is not a profile gives null. */
export function parseProfileHandle(url: string): string | null {
  return url.match(/substack\.com\/@([\w.-]+)/)?.[1] ?? null;
}

async function fetchPublicationSubdomain(handle: string): Promise<string> {
  const profile = await fetchJson(`https://substack.com/api/v1/user/${handle}/public_profile`);
  const subdomain = profile.primaryPublication?.subdomain ?? profile.publicationUsers?.[0]?.publication?.subdomain;
  if (!subdomain) throw new Error(`No publication found for substack handle @${handle}`);
  return subdomain;
}

// We fetch more posts than we need, because paywalled posts and podcast posts
// are filtered out afterwards.
const ARCHIVE_FETCH_LIMIT = 20;

export interface ArchivePost {
  url: string;
  title: string;
  /** ISO timestamp of publication (the archive API's post_date). */
  postDate: string;
}

/** Latest N free text posts of a publication ("https://thezvi.substack.com"), newest first. */
export async function fetchArchivePosts(publicationUrl: string, n: number): Promise<ArchivePost[]> {
  const archive = await fetchJson(`${publicationUrl.replace(/\/$/, "")}/api/v1/archive?sort=new&limit=${ARCHIVE_FETCH_LIMIT}`);
  return (archive as any[])
    .filter((p) => p.audience === "everyone" && p.type !== "podcast")
    .slice(0, n)
    .map((p) => ({ url: p.canonical_url as string, title: p.title as string, postDate: p.post_date as string }));
}

/** Latest N free text posts of a profile ("https://substack.com/@handle/posts"), newest first. */
export async function fetchLatestFreePosts(profileUrl: string, n: number): Promise<ArchivePost[]> {
  const handle = parseProfileHandle(profileUrl);
  if (!handle) throw new Error(`Not a substack profile URL: ${profileUrl}`);
  const subdomain = await fetchPublicationSubdomain(handle);
  return fetchArchivePosts(`https://${subdomain}.substack.com`, n);
}

export interface FeedPost {
  url: string;
  title: string;
  /** ISO timestamp of publication (the feed's pubDate). */
  publishedAt: string;
  /** Full post HTML (RSS content:encoded). */
  bodyHtml: string;
  /** True for a paid post. Its RSS body is only the free preview, and that
   *  preview ends in a "Read more" link back to the post. */
  paywalled: boolean;
}

const PAYWALL_TRAILER = /<a href="[^"]*">\s*Read more\s*<\/a>\s*<\/p>\s*$/;

/** Substack answers a datacenter IP with a 403, so in CI the RSS fetch goes
 *  through our Cloudflare Worker relay in src/everything/substack-proxy-worker.
 *  Substack serves that relay's traffic reliably. On a local machine the proxy
 *  environment variables are unset and we fetch Substack directly. */
function feedRequest(feedUrl: string): { url: string; headers?: Record<string, string> } {
  const proxyUrl = process.env.SUBSTACK_PROXY_URL;
  if (!proxyUrl) return { url: feedUrl };
  return {
    url: `${proxyUrl}?url=${encodeURIComponent(feedUrl)}`,
    headers: { "X-Proxy-Key": process.env.SUBSTACK_PROXY_KEY ?? "" },
  };
}

const cdataUnwrap = (raw: string): string =>
  raw
    .trim()
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    // A "]]>" inside CDATA is encoded by splitting the section in two. We join
    // the two halves back together here.
    .replace(/\]\]><!\[CDATA\[/g, "");

function tagContent(item: string, tag: string): string {
  return item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
}

/** The proxy serves feeds from a cache it refreshes in the background. A cache
 *  older than this means the proxy's own fetches of Substack have been failing
 *  for a long time. We then fail loudly instead of quietly reading frozen data
 *  forever. */
const MAX_PROXY_CACHE_AGE_SECONDS = 24 * 3600;

/** Reads a publication's RSS feed, so "https://thezvi.substack.com" becomes its
 *  /feed. It returns the roughly 20 latest posts, newest first, each with the
 *  full post HTML. This is the only Substack endpoint the automated pipeline
 *  uses. Feed-reader traffic is the one kind Substack serves to a
 *  non-residential IP. */
export async function fetchFeedPosts(publicationUrl: string): Promise<FeedPost[]> {
  const { url, headers } = feedRequest(`${publicationUrl.replace(/\/$/, "")}/feed`);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const cacheAgeSeconds = Number(res.headers.get("X-Cache-Age-Seconds") ?? 0);
  if (cacheAgeSeconds > MAX_PROXY_CACHE_AGE_SECONDS) {
    throw new Error(`Proxy cache for ${url} is ${Math.round(cacheAgeSeconds / 3600)}h old — its Substack fetches must be failing`);
  }
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(([, item]) => {
      const bodyHtml = cdataUnwrap(tagContent(item!, "content:encoded"));
      return {
        url: tagContent(item!, "link").trim(),
        title: decodeHtmlEntities(cdataUnwrap(tagContent(item!, "title"))),
        publishedAt: new Date(tagContent(item!, "pubDate").trim()).toISOString(),
        bodyHtml,
        paywalled: PAYWALL_TRAILER.test(bodyHtml),
      };
    })
    .filter((p) => p.url && p.bodyHtml);
}

/** The placeholder we leave in the plain text where an image stood. The
 *  extractor later renders the image and its URL at that exact point in the
 *  article. */
export function imageMarker(url: string): string {
  return `[[IMAGE:${url}]]`;
}
export const IMAGE_MARKER_RE = /\[\[IMAGE:(.*?)\]\]/g;

/** Replaces each <img> tag with an inline image marker carrying its URL. An
 *  image inlined as a data URI is dropped instead, because there is no URL the
 *  image analysis could fetch. */
function imagesToMarkers(html: string): string {
  return html.replace(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi, (_m, src) =>
    src.startsWith("data:") ? "" : `\n\n${imageMarker(src)}\n\n`,
  );
}

/** Strips body_html down to plain text whose blocks are separated by blank
 *  lines. Chunking later splits the text on those blank lines. With
 *  `keepImages` an inline `<img>` tag survives as an `[[IMAGE:url]]` marker
 *  instead of being dropped. */
export function htmlToText(html: string, keepImages = false): string {
  const withImages = keepImages ? imagesToMarkers(html) : html;
  const text = withImages
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|blockquote|div|figcaption)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(text)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchSubstackPost(url: string): Promise<FetchedContent> {
  const m = url.match(/^https?:\/\/([\w-]+)\.substack\.com\/p\/([\w-]+)/);
  if (!m) throw new Error(`Not a substack post URL: ${url}`);
  const [, subdomain, slug] = m;
  const post = await fetchJson(`https://${subdomain}.substack.com/api/v1/posts/${slug}`);
  if (!post.body_html) throw new Error(`No body_html for ${url} (paywalled or podcast-only?)`);
  const text = htmlToText(post.body_html, true);
  if (!text) throw new Error(`Empty body for ${url}`);
  return {
    kind: "substack",
    url: post.canonical_url ?? url,
    title: post.title ?? slug,
    publishedAt: post.post_date,
    text,
  };
}
