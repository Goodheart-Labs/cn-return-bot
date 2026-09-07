/**
 * Gives creators priority for the next 7 days (GOO-60, reworked by GOO-107).
 * A creator holding priority is walked ahead of every creator we walk only
 * because readers visited them, and behind individually requested pages.
 * Running the script again extends the window from now.
 *
 * This is the same grant the button in the extension makes. The button writes
 * its own row through the database trigger in migration 086; this script does
 * it with the service key, so it can also prioritise a creator whose URL shape
 * the extension would not recognise.
 *
 * Takes one or more creator links: a *.substack.com publication root, a
 * custom-domain Substack publication page (the page names its *.substack.com
 * form inside its preloads blob), a YouTube channel URL, or a LessWrong or
 * Alignment Forum author page.
 *
 * The feed is not listed to check it exists. That check used to run here and in
 * the follow-request consumer, and it was throwing away about one request in
 * six whenever our Substack relay answered 503. A creator whose feed cannot be
 * read is skipped by the walk with a line in the log, and drops out by
 * themselves when the window lapses.
 *
 * Usage:
 *   bun run everything-prioritize <creator-url...>
 */

import "dotenv/config";
import { upsertCreatorPriority } from "./db";
import { canonicalFeed, canonicalSubstackFeed, type CanonicalFeed } from "./feedUrls";

const PRIORITY_DAYS = 7;

/** Resolves a creator link to its canonical feed. A URL of no known shape is
 *  fetched once: a custom-domain Substack page names its subdomain inside the
 *  preloads blob (the same read the extension does on-device). */
async function resolveCreator(url: string): Promise<CanonicalFeed> {
  const direct = canonicalFeed(url);
  if (direct) return direct;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`not a known creator URL shape, and fetching it failed (${res.status})`);
  const m = (await res.text()).match(/subdomain\\?":\\?"([\w-]+)\\?"/);
  const feed = m && canonicalSubstackFeed(`https://${m[1]!.toLowerCase()}.substack.com`);
  if (!feed) throw new Error("not a Substack publication, YouTube channel, or forum author URL");
  return feed;
}

async function prioritizeCreator(url: string, until: Date): Promise<void> {
  const feed = await resolveCreator(url);
  await upsertCreatorPriority(feed, until);
  console.log(`priority until ${until.toISOString().slice(0, 10)}: [${feed.feed_type}] ${feed.feed_url}`);
}

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("Usage: bun run everything-prioritize <creator-url...>");
    process.exit(1);
  }

  const until = new Date(Date.now() + PRIORITY_DAYS * 24 * 3600_000);
  let failed = false;
  for (const url of urls) {
    try {
      await prioritizeCreator(url, until);
    } catch (err: any) {
      failed = true;
      console.error(`failed for ${url}: ${err?.message}`);
    }
  }
  if (failed) process.exit(1);
}

main();
