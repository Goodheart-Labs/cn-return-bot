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
import { parseAuthorFeedUrl, readForumAuthor, type ForumListing } from "./sites/forum";

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
  if (SUBSTACK_PUBLICATION_URL.test(request.feedUrl)) return { kind: "substack", xml: await readSubstackFeed(request.feedUrl) };
  throw new Error(`Not a feed we list: ${request.feedUrl}`);
}

function summarizeListing(listing: Listing): ReadOutcome {
  const text = listing.kind === "substack" ? listing.xml : JSON.stringify(listing.listing);
  return { outcome: "listing", via: listing.kind, chars: text.length, reason: null, text };
}

/** A forum author's name, picture and latest `limit` posts. */
export async function readForumListing(feedUrl: string, limit: number): Promise<ForumListing> {
  const listing = await readListing({ feedUrl, limit });
  if (listing.kind !== "forum") throw new Error(`Not a forum author: ${feedUrl}`);
  return listing.listing;
}

async function readSubstackFeed(publicationUrl: string): Promise<string> {
  const read = await readApi(`${publicationUrl}/feed`);
  if (read.type === "unreadable") throw new Error(`${publicationUrl}/feed: ${read.reason}`);
  return read.body;
}
