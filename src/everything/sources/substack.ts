/**
 * Substack listings. Nothing here scrapes a rendered page. We read Substack's
 * public JSON API and its RSS feed:
 *   - substack.com/api/v1/user/<handle>/public_profile   → the publication subdomain
 *   - <sub>.substack.com/api/v1/archive?sort=new&limit=N → the latest posts
 *   - <sub>.substack.com/api/v1/archive?sort=top&limit=N → the most liked posts
 *   - <sub>.substack.com/feed                            → the latest posts with their bodies
 *
 * The RSS feed is what the walk reads, through the page reader's readListing,
 * because Substack refuses GitHub's machines. Substack's API refuses some
 * datacenter addresses, so the top-post refresh in GitHub Actions goes
 * through the residential proxy (fetchJsonViaResidentialProxy). Proxy traffic
 * is paid per gigabyte, which is fine at this volume: one archive call per
 * publication every 60 days. A single post is read by the page reader, which
 * asks Substack's post endpoint (src/pipeline/fetch/sites/substack.ts).
 */

import { readListing } from "../../pipeline/fetch/readListing";
import { decodeHtmlEntities } from "../../pipeline/utils/html";
import { fetchJsonViaResidentialProxy } from "../../pipeline/utils/residentialProxy";

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
 *  newest first, each with the full post HTML. Feed-reader traffic is the one
 *  kind Substack serves to a non-residential IP. */
export async function fetchFeedPosts(publicationUrl: string): Promise<SubstackFeed> {
  const listing = await readListing({ feedUrl: publicationUrl.replace(/\/$/, ""), limit: 0 });
  if (listing.kind !== "substack") throw new Error(`Not a Substack publication: ${publicationUrl}`);
  const { xml } = listing;
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
