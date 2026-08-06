/**
 * Substack ingestion via its public JSON API — no scraping:
 *   - substack.com/api/v1/user/<handle>/public_profile   → publication subdomain
 *   - <sub>.substack.com/api/v1/archive?sort=new&limit=N → latest posts
 *   - <sub>.substack.com/api/v1/posts/<slug>             → full body_html (free posts)
 */

import { decodeHtmlEntities } from "../../pipeline/utils/html";
import type { FetchedContent } from "../types";

// Substack 403s requests that don't look like a browser (e.g. from GitHub
// Actions runners); plain local fetches pass, so this only levels the field.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
};

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
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
export const ARCHIVE_FETCH_LIMIT = 20;

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
