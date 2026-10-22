import { normalizeFeedUrl } from "./pageUrls";

/** How many of a creator's posts their score averages over. A creator's score
 *  is the average number of different people per post, taken over the
 *  creator's posts that were visited most recently (GOO-257). There is no time
 *  window, so a creator who posts rarely keeps their score until newer visits
 *  replace it.
 *
 *  It lives here because two places have to agree on it: the pipeline walks
 *  creators on the score, and the analytics dashboard shows it. Both pass it
 *  to the database rather than the database holding a copy. */
export const LAST_POSTS_PER_CREATOR = 10;

/** The lowest score at which the walk takes a creator on visits alone. A
 *  prioritised creator is walked whatever their visits, because someone asked
 *  for them. It lives here for the same reason as LAST_POSTS_PER_CREATOR: the
 *  analytics dashboard lists the creators the walk would take. */
export const MIN_SCORE_TO_WALK = 1.5;

/** What the walk's order looks at in a creator. */
export interface WalkOrderKey {
  prioritized: boolean;
  feed_url: string;
  score: { visitors_per_post: number; people: number };
}

/** The walk's order: prioritised creators first, then the highest score.
 *  Among equal scores, the creator more different people visited goes first.
 *  The order ends on the feed address, so a tie sorts the same way on every
 *  run rather than depending on how the database returned the rows. */
export const byWalkOrder = (a: WalkOrderKey, b: WalkOrderKey): number =>
  Number(b.prioritized) - Number(a.prioritized) ||
  b.score.visitors_per_post - a.score.visitors_per_post ||
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
