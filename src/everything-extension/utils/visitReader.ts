import { browser } from "#imports";
import { readerHash } from "../../everything-shared/readerHash";

/** The reader secret: one random value per installation, kept here and sent
 *  nowhere (GOO-135).
 *
 *  A visit row carries a hash of this secret combined with the creator's feed
 *  address, so the database can count how many different people read a creator
 *  while the rows about two different creators stay unlinkable. The secret
 *  itself never leaves the device, so nobody else can compute or recognise
 *  those hashes.
 *
 *  It is minted lazily and only in the background, the same single-writer rule
 *  the analytics device id follows. Two tabs opening at once in a content
 *  script could each mint one, and the loser's visits would then look like a
 *  second reader. Signing out does not replace it: it is never attached to an
 *  account, so there is nothing to unlink, and replacing it would turn one
 *  reader into two in the counts. */

const READER_SECRET_KEY = "cn-visit-secret";

async function readerSecret(): Promise<string> {
  const stored = await browser.storage.local.get(READER_SECRET_KEY);
  if (typeof stored[READER_SECRET_KEY] === "string") return stored[READER_SECRET_KEY];
  const fresh = crypto.randomUUID();
  await browser.storage.local.set({ [READER_SECRET_KEY]: fresh });
  return fresh;
}

/** This browser's value for one creator. Background only. */
export async function visitReaderHash(feedUrl: string): Promise<string> {
  return readerHash(await readerSecret(), feedUrl);
}
