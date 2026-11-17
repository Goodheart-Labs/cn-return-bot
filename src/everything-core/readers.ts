import { normalizeFeedUrl } from "./pageUrls";

/** How many of a creator's posts their score averages over. A creator's score
 *  is the average number of different people per post, taken over the
 *  creator's posts that were visited most recently (GOO-257). There is no time
 *  window, so a creator who posts rarely keeps their score until newer visits
 *  replace it.
 *
 *  The walk and the dashboard read the visit numbers from the materialized
 *  view everything_creator_visits, which has 10 written into its query
 *  (migration 135). A change here needs a migration that recreates the view.
 *  The dashboard still passes this number to the database for the delay and
 *  the vote rate, and to everything_recent_posts. */
export const LAST_POSTS_PER_CREATOR = 10;

/** The creator score adds imagined posts to the creator's real ones, so a
 *  creator with only a few visited posts cannot rank high on one shared link
 *  (GOO-549). Jim picked the numbers in a playground on 2026-10-23. Every
 *  creator gets this many imagined posts that nobody read, which pulls every
 *  score toward 0. */
export const IMAGINED_UNREAD_POSTS = 2;

/** And this many imagined posts with the average number of readers per post
 *  (averageReadersPerPost). Together they pull a creator with few posts toward
 *  a typical creator. A creator with 10 real posts barely moves. */
export const IMAGINED_AVERAGE_POSTS = 3;

/** The lowest score at which the walk takes a creator on visits alone. A
 *  prioritised creator is walked whatever their visits, because someone asked
 *  for them. It lives here for the same reason as LAST_POSTS_PER_CREATOR: the
 *  admins' dashboard lists the creators the walk would take. It was 1.5
 *  until 2026-10-23, on the plain average without imagined posts. */
export const MIN_SCORE_TO_WALK = 1;

/** How many of a creator's posts must have been visited before their score
 *  counts. A single post that a few people opened, often one shared link, says
 *  little about how widely the creator is read. */
export const MIN_VISITED_POSTS_TO_WALK = 2;

/** What a creator's visits come to: the average number of different people
 *  per post, and over how many posts. */
export interface CreatorVisits {
  visitors_per_post: number;
  posts: number;
}

/** The average number of different people per visited post, over every
 *  visited creator, weighted by their visited posts. It was 1.07 over 8,740
 *  posts on 2026-10-23. The walk computes it from the creators it ranks, and
 *  everything_creator_ranking (migration 134) computes it the same way in the
 *  database. */
export function averageReadersPerPost(creators: CreatorVisits[]): number {
  const posts = creators.reduce((sum, c) => sum + c.posts, 0);
  if (posts === 0) return 0;
  return creators.reduce((sum, c) => sum + c.visitors_per_post * c.posts, 0) / posts;
}

/** A creator's score: the average number of different people per post, with
 *  the imagined posts counted as if they were real. The walk ranks on it. The
 *  database applies the same formula in everything_creator_ranking (migration
 *  134) and ranks the dashboard by it in everything_creator_ranking_page
 *  (migration 141), with these constants passed in. */
export const creatorScore = (visits: CreatorVisits, averageReaders: number): number =>
  (visits.visitors_per_post * visits.posts + IMAGINED_AVERAGE_POSTS * averageReaders) /
  (visits.posts + IMAGINED_AVERAGE_POSTS + IMAGINED_UNREAD_POSTS);

/** What the walk's order looks at in a creator. */
export interface WalkOrderKey {
  prioritized: boolean;
  feed_url: string;
  /** The creator's score (creatorScore). */
  walkScore: number;
  score: { people: number };
}

/** The walk's order: prioritised creators first, then the highest score.
 *  Among equal scores, the creator more different people visited goes first.
 *  The order ends on the feed address, so a tie sorts the same way on every
 *  run rather than depending on how the database returned the rows. */
export const byWalkOrder = (a: WalkOrderKey, b: WalkOrderKey): number =>
  Number(b.prioritized) - Number(a.prioritized) ||
  b.walkScore - a.walkScore ||
  b.score.people - a.score.people ||
  a.feed_url.localeCompare(b.feed_url);

/** The value a visit row carries instead of an identifier: one per browser and
 *  per creator (GOO-135).
 *
 *  The extension keeps a random secret that never leaves the device, and sends
 *  a SHA-256 hash of that secret together with the creator's feed address. A
 *  hash is one-way, so the value tells nobody anything without the secret. Two
 *  properties follow, and both are the point of the design. Every visit from
 *  one browser to one creator carries the same value, so the database can count
 *  how many different people read that creator. A visit to a different creator
 *  carries an unrelated value, so the visit rows can never be assembled into
 *  one person's reading across creators.
 *
 *  What this does not prevent: somebody holding the whole database can still
 *  guess that one creator's reader is one particular account, by matching when
 *  the account appeared against when that reader's value first appeared. The
 *  design stops those guesses being joined together.
 */
export async function readerHash(secret: string, feedUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${secret}\n${normalizeFeedUrl(feedUrl)}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
