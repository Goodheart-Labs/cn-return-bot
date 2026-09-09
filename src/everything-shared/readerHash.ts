import { normalizeFeedUrl } from "./pageUrls";

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
