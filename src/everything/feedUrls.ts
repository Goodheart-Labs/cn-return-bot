/** The one canonical shape of a creator feed. A Substack feed must be in its
 *  *.substack.com form, because that is the only shape the RSS relay accepts
 *  in CI. A YouTube feed is the channel URL. A LessWrong or Alignment Forum
 *  feed is the author's profile URL. The follow-request consumer, the creator
 *  ranking, and the prioritize script all normalize through here. */

import { parseAuthorFeedUrl } from "./sources/lesswrong";

export type FeedType = "substack" | "youtube" | "lesswrong";

export interface CanonicalFeed {
  project_slug: string;
  feed_type: FeedType;
  feed_url: string;
}

/** The canonical feed for a *.substack.com publication root, or null when the
 *  URL is not one. www is not a publication. */
export function canonicalSubstackFeed(url: string): CanonicalFeed | null {
  const m = url.match(/^https:\/\/([\w-]+)\.substack\.com\/?$/);
  if (!m || m[1]!.toLowerCase() === "www") return null;
  const sub = m[1]!.toLowerCase();
  return { project_slug: sub, feed_type: "substack", feed_url: `https://${sub}.substack.com` };
}

/** The canonical feed for a YouTube channel URL (@handle or /channel/id), or
 *  null when the URL is not one. The channel id's casing is preserved,
 *  because /channel/UC… ids are case-sensitive. */
export function canonicalYoutubeFeed(url: string): CanonicalFeed | null {
  const m = url.match(/^https:\/\/(?:www\.)?youtube\.com\/(@[\w.-]+|channel\/[\w-]+)\/?$/);
  if (!m) return null;
  const path = m[1]!;
  return {
    project_slug: path.replace(/^@|^channel\//, "").toLowerCase(),
    feed_type: "youtube",
    feed_url: `https://www.youtube.com/${path}`,
  };
}

/** The canonical feed for a LessWrong or Alignment Forum author URL, or null
 *  when the URL is not one. The two sites share their user accounts, so the
 *  same slug on both sites is the same person and lands in one project; the
 *  host in the feed URL decides which site's posts are walked. */
export function canonicalLesswrongFeed(url: string): CanonicalFeed | null {
  const author = parseAuthorFeedUrl(url);
  if (!author) return null;
  return {
    project_slug: author.slug.toLowerCase(),
    feed_type: "lesswrong",
    feed_url: `${author.origin}/users/${author.slug.toLowerCase()}`,
  };
}

/** The canonical feed for any creator URL of a known shape, or null. */
export function canonicalFeed(url: string): CanonicalFeed | null {
  return canonicalSubstackFeed(url) ?? canonicalYoutubeFeed(url) ?? canonicalLesswrongFeed(url);
}
