/**
 * The walk's listings: which posts a creator published lately. A Substack
 * publication lists them in its RSS feed, and a forum author through the
 * forum's GraphQL API. Both go through readApi. A YouTube channel is listed by
 * the Data API instead (youtubeChannels.ts), which needs a key and no fetcher.
 *
 * GitHub Actions never fetches an outside address itself. Substack refuses
 * GitHub's machines, and a forum behind a bot check would refuse them too. So
 * there readListing asks the extraction service, which reads the listing on
 * the services machine.
 */

import { requestListing } from "../../service/client";
import type { Listing, ListingRequest } from "../../service/contract";
import { readApi } from "./readApi";
import { logRead, type ReadOutcome } from "./readLog";
import { parseAuthorFeedUrl, readForumAuthor, readForumNewest, type ForumListing, type NewestForumPost } from "./sites/forum";

/** A publication's feed address in the form everything_projects.feed_url
 *  stores it. Only such an address is listed, so a listing request cannot be
 *  used to fetch any other address. */
const SUBSTACK_PUBLICATION_URL = /^https:\/\/[\w-]+\.substack\.com$/;

export async function readListing(request: ListingRequest): Promise<Listing> {
  if (process.env.GITHUB_ACTIONS) return requestListing(request);
  return logRead("listing", request.feedUrl, () => readListingHere(request), summarizeListing);
}

async function readListingHere(request: ListingRequest): Promise<Listing> {
  const forumAuthor = parseAuthorFeedUrl(request.feedUrl);
  if (forumAuthor) return { kind: "forum", listing: await readForumAuthor(forumAuthor, request.limit) };
  if (SUBSTACK_PUBLICATION_URL.test(request.feedUrl)) return readSubstackFeed(request.feedUrl, request.etag);
  throw new Error(`Not a feed we list: ${request.feedUrl}`);
}

function summarizeListing(listing: Listing): ReadOutcome {
  if (listing.kind === "not_modified") return { outcome: "listing", via: "not modified", chars: 0, reason: null, text: "" };
  const text = listing.kind === "substack" ? listing.xml : JSON.stringify(listing.listing);
  return { outcome: "listing", via: listing.kind, chars: text.length, reason: null, text };
}

/** A forum author's name, picture and latest `limit` posts. */
export async function readForumListing(feedUrl: string, limit: number): Promise<ForumListing> {
  const listing = await readListing({ feedUrl, limit });
  if (listing.kind !== "forum") throw new Error(`Not a forum author: ${feedUrl}`);
  return listing.listing;
}

async function readSubstackFeed(publicationUrl: string, etag: string | undefined): Promise<Listing> {
  const read = await readApi(`${publicationUrl}/feed`, { etag });
  if (read.type === "unreadable") throw new Error(`${publicationUrl}/feed: ${read.reason}`);
  if (read.type === "not_modified") return { kind: "not_modified" };
  return { kind: "substack", xml: read.body, etag: read.etag ?? null };
}

/** A forum's newest posts of every author, for cn-walk on the services box,
 *  which reads outside addresses through the fetcher. Recorded in the read
 *  log like every listing. */
export function readForumNewestPosts(origin: string, limit: number): Promise<NewestForumPost[]> {
  return logRead("listing", `${origin}/graphql (newest posts)`, () => readForumNewest(origin, limit), (posts) => {
    const text = JSON.stringify(posts);
    return { outcome: "listing", via: "forum", chars: text.length, reason: null, text };
  });
}
