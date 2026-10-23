/**
 * Substack ingestion. Nothing here scrapes a rendered page. We read Substack's
 * public JSON API and its RSS feed:
 *   - substack.com/api/v1/user/<handle>/public_profile   → the publication subdomain
 *   - <sub>.substack.com/api/v1/archive?sort=new&limit=N → the latest posts
 *   - <sub>.substack.com/api/v1/posts/<slug>             → a free post's full body_html
 *   - <sub>.substack.com/feed                            → the latest posts with their bodies
 *
 * Substack's API refuses datacenter IPs, so the archive and post calls go
 * through the residential proxy (fetchJsonViaResidentialProxy). Proxy traffic
 * is paid per gigabyte, which is fine at this volume: the top-post refresh
 * makes one archive call per publication per week, and one body call per
 * enqueued top post. The RSS feed is the one endpoint Substack serves to our
 * services machine, but it still refuses GitHub's machines (see fetchFeedXml).
 */

import { callFetchService, requestSubstackFeed } from "../../service/client";
import { FETCH_SERVICE_SOCKET_VARIABLE, SUBSTACK_FEED_PATH, type SubstackFeedXml } from "../../service/contract";
import { decodeHtmlEntities } from "../../pipeline/utils/html";
import { fetchJsonViaResidentialProxy } from "../../pipeline/utils/residentialProxy";
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

async function fetchPublication(handle: string): Promise<{ subdomain: string; name?: string }> {
  const profile = await fetchJson(`https://substack.com/api/v1/user/${handle}/public_profile`);
  const publication = profile.primaryPublication ?? profile.publicationUsers?.[0]?.publication;
  if (!publication?.subdomain) throw new Error(`No publication found for substack handle @${handle}`);
  return { subdomain: publication.subdomain, name: publication.name ?? undefined };
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

/** Latest N free text posts of a profile ("https://substack.com/@handle/posts"),
 *  newest first, together with the publication's display name. */
export async function fetchLatestFreePosts(
  profileUrl: string,
  n: number,
): Promise<{ publicationName?: string; posts: ArchivePost[] }> {
  const handle = parseProfileHandle(profileUrl);
  if (!handle) throw new Error(`Not a substack profile URL: ${profileUrl}`);
  const publication = await fetchPublication(handle);
  return { publicationName: publication.name, posts: await fetchArchivePosts(`https://${publication.subdomain}.substack.com`, n) };
}

export interface TopArchivePost {
  url: string;
  title: string;
  /** ISO timestamp of publication (the archive API's post_date). */
  postDate: string;
  likes: number;
}

/** A publication's n most liked free text posts of all time, most liked
 *  first. The archive API's "top" sort is the source listing, but its order
 *  is Substack's own blend, so the posts are re-sorted by their like counts:
 *  likes are the popularity signal we rank on, and the only one Substack
 *  makes public besides restacks. Paid posts are left out, because we could
 *  not read their bodies anyway. */
export async function fetchTopArchivePosts(publicationUrl: string, n: number): Promise<TopArchivePost[]> {
  const archive = await fetchJsonViaResidentialProxy(
    `${publicationUrl.replace(/\/$/, "")}/api/v1/archive?sort=top&limit=${ARCHIVE_FETCH_LIMIT}`,
  );
  return (archive as any[])
    .filter((p) => p.audience === "everyone" && p.type !== "podcast")
    .map((p) => ({
      url: p.canonical_url as string,
      title: p.title as string,
      postDate: p.post_date as string,
      likes: Object.values((p.reactions ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.likes - a.likes)
    .slice(0, n);
}

/** A post's body as the pipeline's plain text, with inline image markers. The
 *  top-post enqueue uses this for archive posts that are too old to appear in
 *  the RSS feed, so the worker never has to fetch Substack itself. The API
 *  host comes from the publication URL rather than the post URL, because a
 *  custom-domain publication's canonical post URLs live on that custom domain
 *  while our stored feed URL keeps the *.substack.com form. */
export async function fetchPostBodyText(publicationUrl: string, postUrl: string): Promise<string> {
  const slug = postUrl.match(/\/p\/([\w-]+)/)?.[1];
  if (!slug) throw new Error(`Not a substack post URL: ${postUrl}`);
  const post = await fetchJsonViaResidentialProxy(`${publicationUrl.replace(/\/$/, "")}/api/v1/posts/${slug}`);
  if (!post.body_html) throw new Error(`No body_html for ${postUrl} (paywalled or podcast-only?)`);
  const text = htmlToText(post.body_html, true);
  if (!text) throw new Error(`Empty body for ${postUrl}`);
  return text;
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

/** Only a publication's own feed may be fetched through the services machine,
 *  so the route cannot be used to fetch any other address. */
const SUBSTACK_FEED_URL = /^https:\/\/[\w-]+\.substack\.com\/feed$/;

/** Fetches a feed from where this process runs. The fetcher on the services
 *  machine calls this, and so does a local run. */
export async function fetchFeedXmlDirectly(feedUrl: string): Promise<SubstackFeedXml> {
  if (!SUBSTACK_FEED_URL.test(feedUrl)) throw new Error(`Not a Substack feed URL: ${feedUrl}`);
  const res = await fetch(feedUrl);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${feedUrl}`);
  return { xml: await res.text() };
}

/** Substack answers GitHub's machines with a 403, so a GitHub Actions run asks
 *  the extraction service on the services machine for the feed. On that
 *  machine only the sandboxed fetcher reaches outside addresses, so the
 *  service asks the fetcher. A local run fetches Substack directly.
 *
 *  Until 2026-10-23 GitHub runs read feeds through a Cloudflare Worker that
 *  kept a cached copy of each feed. On Cloudflare's free plan it could keep
 *  only about 13 feeds fresh, and its copies were often hours old. Zvi's post
 *  of 21 October waited 7 hours before the walk saw it (GOO-549). */
export async function fetchFeedXml(feedUrl: string): Promise<SubstackFeedXml> {
  if (process.env.GITHUB_ACTIONS) return requestSubstackFeed({ url: feedUrl });
  const socket = process.env[FETCH_SERVICE_SOCKET_VARIABLE];
  if (socket) return callFetchService<SubstackFeedXml>(socket, SUBSTACK_FEED_PATH, { url: feedUrl });
  return fetchFeedXmlDirectly(feedUrl);
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

export interface SubstackFeed {
  /** The publication's display name, from the feed's channel title. */
  title?: string;
  /** The publication's logo, from the feed's channel image. */
  imageUrl?: string;
  posts: FeedPost[];
}

/** Reads a publication's RSS feed, so "https://thezvi.substack.com" becomes its
 *  /feed. It returns the publication's name and the roughly 20 latest posts,
 *  newest first, each with the full post HTML. This is the only Substack
 *  endpoint the automated pipeline uses. Feed-reader traffic is the one kind
 *  Substack serves to a non-residential IP. */
export async function fetchFeedPosts(publicationUrl: string): Promise<SubstackFeed> {
  const { xml } = await fetchFeedXml(`${publicationUrl.replace(/\/$/, "")}/feed`);
  // The channel's own title is the first <title> before any <item>. The items
  // carry <title> tags too, so the channel block is cut out first.
  const channelXml = xml.split("<item>")[0]!;
  const title = decodeHtmlEntities(cdataUnwrap(tagContent(channelXml, "title"))).trim() || undefined;
  const imageUrl = cdataUnwrap(tagContent(tagContent(channelXml, "image"), "url")).trim() || undefined;
  const posts = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
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
  return { title, imageUrl, posts };
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

/** The publication's display name, read out of a post's bylines. The byline
 *  lists every publication its author writes for, so the one whose subdomain
 *  matches the post's own is the one the post belongs to. */
function publicationNameFromPost(post: any, subdomain: string): string | undefined {
  const publications = (post.publishedBylines ?? [])
    .flatMap((byline: any) => byline.publicationUsers ?? [])
    .map((pu: any) => pu.publication)
    .filter(Boolean);
  return publications.find((p: any) => p.subdomain === subdomain)?.name ?? undefined;
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
    authorName: publicationNameFromPost(post, subdomain!),
  };
}
