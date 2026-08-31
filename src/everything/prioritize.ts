/**
 * Flags creators as priority for the next 7 days (GOO-60). A flagged creator
 * ranks strictly above every unflagged creator in the auto-enqueue walk, right
 * below individually requested pages. Running the script again extends the
 * window from now.
 *
 * Takes one or more creator links: a *.substack.com publication root, a
 * custom-domain Substack publication page (the page names its *.substack.com
 * form inside its preloads blob), or a YouTube channel URL. Each feed is
 * listed once before it is stored, the same validation a reader's follow
 * request gets, and a creator we do not follow yet gets a feed row at the
 * followed tier.
 *
 * Usage:
 *   bun run everything-prioritize <creator-url...>
 */

import "dotenv/config";
import { fillProjectDisplayNameBySlug, upsertFeedPriority } from "./db";
import { canonicalFeed, canonicalSubstackFeed, type CanonicalFeed } from "./feedUrls";
import { fetchFeedPosts } from "./sources/substack";
import { ensureYtDlp, fetchChannelVideos } from "./sources/youtube";

const PRIORITY_FLAG_DAYS = 7;

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
  if (!feed) throw new Error("not a Substack publication or YouTube channel URL");
  return feed;
}

async function prioritizeCreator(url: string, until: Date): Promise<void> {
  const feed = await resolveCreator(url);
  const sourceName =
    feed.feed_type === "substack"
      ? (await fetchFeedPosts(feed.feed_url)).title
      : fetchChannelVideos(feed.feed_url, 1).channelName;
  await fillProjectDisplayNameBySlug(feed.project_slug, sourceName);
  await upsertFeedPriority(feed, until);
  console.log(`priority until ${until.toISOString().slice(0, 10)}: [${feed.feed_type}] ${feed.feed_url} (${sourceName ?? feed.project_slug})`);
}

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("Usage: bun run everything-prioritize <creator-url...>");
    process.exit(1);
  }
  if (urls.some((u) => canonicalFeed(u)?.feed_type === "youtube")) ensureYtDlp();

  const until = new Date(Date.now() + PRIORITY_FLAG_DAYS * 24 * 3600_000);
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
