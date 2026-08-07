/**
 * Substack ingestion via its public JSON API — no scraping:
 *   - substack.com/api/v1/user/<handle>/public_profile   → publication subdomain
 *   - <sub>.substack.com/api/v1/archive?sort=new&limit=N → latest posts
 *   - <sub>.substack.com/api/v1/posts/<slug>             → full body_html (free posts)
 */

import { decodeHtmlEntities } from "../../pipeline/utils/html";
import type { FetchedContent } from "../types";

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** "https://substack.com/@garymarcus/posts" → "garymarcus" (null if not a profile URL). */
export function parseProfileHandle(url: string): string | null {
  return url.match(/substack\.com\/@([\w.-]+)/)?.[1] ?? null;
}

async function fetchPublicationSubdomain(handle: string): Promise<string> {
  const profile = await fetchJson(`https://substack.com/api/v1/user/${handle}/public_profile`);
  const subdomain = profile.primaryPublication?.subdomain ?? profile.publicationUsers?.[0]?.publication?.subdomain;
  if (!subdomain) throw new Error(`No publication found for substack handle @${handle}`);
  return subdomain;
}

// Fetch more than needed: paywalled and podcast-type posts are filtered out.
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
  /** True for paid posts: their RSS body is only the free preview, ending in a
   *  "Read more" link back to the post. */
  paywalled: boolean;
}

const PAYWALL_TRAILER = /<a href="[^"]*">\s*Read more\s*<\/a>\s*<\/p>\s*$/;

/** Substack blocks datacenter IPs (403), so in CI the RSS fetch goes through
 *  our Cloudflare Worker relay (src/everything/substack-proxy-worker) — its
 *  egress is served reliably. Locally the env vars are unset → direct fetch. */
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
    // a "]]>" inside CDATA is encoded by splitting the section — rejoin it
    .replace(/\]\]><!\[CDATA\[/g, "");

function tagContent(item: string, tag: string): string {
  return item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
}

/** The proxy serves feeds from a background-refreshed cache; a stale cache
 *  means its live fetches have been failing for a long time — fail loudly
 *  instead of quietly re-reading frozen data forever. */
const MAX_PROXY_CACHE_AGE_SECONDS = 24 * 3600;

/** A publication's RSS feed ("https://thezvi.substack.com" → /feed): its ~20
 *  latest posts, newest first, each with the full post HTML. This is the only
 *  Substack endpoint the automated pipeline uses — feed-reader traffic is the
 *  one kind Substack serves to non-residential IPs. */
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

/** Inline image placeholder left in the plain text so the extractor can render
 *  the image (and its URL) at the point it appears in the article. */
export function imageMarker(url: string): string {
  return `[[IMAGE:${url}]]`;
}
export const IMAGE_MARKER_RE = /\[\[IMAGE:(.*?)\]\]/g;

/** Replace each <img>/<source> with an inline image marker carrying its URL. */
function imagesToMarkers(html: string): string {
  return html.replace(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi, (_m, src) =>
    src.startsWith("data:") ? "" : `\n\n${imageMarker(src)}\n\n`,
  );
}

/** Strip body_html down to blank-line-separated plain-text blocks (chunking
 *  splits on those). With `keepImages`, inline `<img>` tags survive as
 *  `[[IMAGE:url]]` markers instead of being dropped. */
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
