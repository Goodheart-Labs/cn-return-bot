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

/** Latest N free text posts of a profile ("https://substack.com/@handle/posts"). */
export async function fetchLatestFreePostUrls(profileUrl: string, n: number): Promise<string[]> {
  const handle = parseProfileHandle(profileUrl);
  if (!handle) throw new Error(`Not a substack profile URL: ${profileUrl}`);
  const subdomain = await fetchPublicationSubdomain(handle);
  const archive = await fetchJson(
    `https://${subdomain}.substack.com/api/v1/archive?sort=new&limit=${ARCHIVE_FETCH_LIMIT}`,
  );
  return (archive as any[])
    .filter((p) => p.audience === "everyone" && p.type !== "podcast")
    .slice(0, n)
    .map((p) => p.canonical_url as string);
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
