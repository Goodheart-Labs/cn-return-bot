import { normalizeFeedUrl } from "./pageUrls";

/** How many different pages of one creator a reader must open inside the
 *  ranking window before they count as a regular reader of that creator. One
 *  page is a click; a second, different page is somebody who reads them.
 *
 *  It lives here because two places have to agree on it: the pipeline walks
 *  creators on it, and the analytics dashboard reports on it. Both pass it to
 *  the database rather than the database holding a copy. */
export const MIN_PAGES_FOR_A_REGULAR_READER = 2;

/** How many days back a creator's visits and readers count. The pipeline walks
 *  creators on the numbers inside this window, and the dashboard shows each
 *  checked post's author with the same numbers, so both read it from here. */
export const VISIT_RANKING_WINDOW_DAYS = 14;

/** How many regular readers a creator needs before the pipeline walks them on
 *  attention alone. Raise this to two when enough people use the extension for
 *  that to mean something. A creator holding priority is walked whatever their
 *  readers, because someone asked for them. */
export const MIN_REGULAR_READERS_TO_WALK_CREATOR = 1;

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
