/**
 * cn-walk, the walk of Common Notes (GOO-791). A daemon on the services box: a
 * program that runs all the time, kept alive by systemd like cn-intake
 * (ops/cn-walk.service). It keeps every walked creator's feed on a schedule
 * and adds every post of the last 14 days that Common Notes does not have yet
 * to the post list, where the notewriters reserve them. Until GOO-791 the feed
 * run walked the ranking until it found one unchecked post, and only while a
 * notewriter wanted one.
 *
 * Which creators: the ones the ranking walks (creatorRanking.ts), at most
 * MAX_WALKED_CREATORS, reloaded every 10 minutes. Each reload also sets every
 * creator's place in the list (everything_projects.list_rank).
 *
 * How each kind of feed is read:
 *   - YouTube: a channel is listed when YouTube's push notice (WebSub) came,
 *     or its last listing is a day old (youtubeChannels.ts). Checked every
 *     minute from the stored states.
 *   - LessWrong, the Alignment Forum and the EA Forum: one query a minute per
 *     forum for its newest posts of all authors, kept for the walked authors.
 *     The forum is read only while one of its authors is walked. Besides,
 *     one walked author a minute is listed on their own profile, so each is
 *     listed about once a day. That catches a post the newest-posts query
 *     misses, and the log says when it did.
 *   - Substack: each walked publication's feed on its own schedule within a
 *     fixed budget of reads a day (feedSchedule.ts), with the ETag of the last
 *     answer, so an unchanged feed answers 304 with no body.
 *
 * No pile-up: one loop makes one read at a time. It sleeps until the next job
 * is due, runs it, and sets its next time. If reads get slow, every feed is
 * read a little less often; reads never run side by side. Two Substack reads
 * are always at least MIN_SECONDS_BETWEEN_SITE_READS apart.
 *
 * Every 5 minutes it also tidies the list (ends overdue reservations, closes
 * posts that turned 14 days old), refreshes stale creator pictures, tells
 * Slack when one of our own notewriters has not called for 30 minutes, adds
 * the pages several readers opened (demandQueue.ts), and puts posts the
 * intake service could not read back for another attempt (retries.ts).
 *
 * A read that fails is recorded in page_reads like every read, and the feed
 * stays on its schedule. A database error crashes the walk on purpose, and
 * systemd starts it again.
 *
 *   bun run src/walk/main.ts             the daemon
 *   bun run src/walk/main.ts --dry-run   reads the Substack and forum feeds and says what it would add, writes nothing
 */

import "dotenv/config";
import { rankCreators, type RankedCreator } from "../everything/creatorRanking";
import { fetchItemOutcomesSince, fetchRetryableErrorItems, fetchYoutubeChannelStates, requeueErroredItem, setListRanks, tidyList } from "../everything/db";
import { queueDemandedPages } from "../everything/demandQueue";
import { AVATARS_PER_RUN, refreshStaleAvatars } from "../everything/projectAvatars";
import { attemptLabel, FAILING_SOURCE_WINDOW_MS, failingSources, RETRY_WAIT_HOURS } from "../everything/retries";
import { watchNotewriterSilence } from "../everything/silenceWarning";
import { readFeedIfChanged } from "../everything/sources/substack";
import { channelDue, youtubeChannelUploads } from "../everything/youtubeChannels";
import { quotaRanOutThisRun, YoutubeQuotaExceededError } from "../pipeline/media/youtubeDataApi";
import { readForumListing, readForumNewestPosts } from "../pipeline/fetch/readListing";
import { forumOrigin, parseAuthorFeedUrl } from "../pipeline/fetch/sites/forum";
import { feedWaits, nextDue } from "./feedSchedule";
import { addNewPosts, forumEntries, substackEntries, youtubeEntries } from "./posts";

/** At most this many creators of the ranking are walked, creators holding
 *  priority first. The read budget already fixes how many Substack reads
 *  there are, so this bounds what more creators would bring besides: more
 *  posts in the list, more videos read through the paid proxy, and more
 *  YouTube listings. On 2026-11-19, 535 creators qualified. */
const MAX_WALKED_CREATORS = 1000;

/** The rank of a creator holding priority, above every creator score. The
 *  database's everything_priority_rank() is the same number (migration 184). */
const PRIORITY_RANK = 1000;

const MINUTE_MS = 60_000;
const RANKING_EVERY_MS = 10 * MINUTE_MS;
const TIDY_EVERY_MS = 5 * MINUTE_MS;
const FORUMS_EVERY_MS = MINUTE_MS;
const YOUTUBE_EVERY_MS = MINUTE_MS;

/** Two Substack reads are always at least this far apart, whatever the
 *  budget says. Every walked publication is a subdomain of substack.com. */
const MIN_SECONDS_BETWEEN_SITE_READS = 1;

/** The newest posts asked of a forum each minute. On LessWrong that is
 *  about a day of posts. */
const FORUM_NEWEST_POSTS = 50;

/** The posts asked for in one channel's or one author's own listing. */
const LISTING_POSTS = 20;

/** A failing source gets at most this many repeat reads per tidy-up, so a
 *  source that is down spends only a few attempts at a time. */
const RETRIES_PER_FAILING_SOURCE = 2;

const dryRun = process.argv.includes("--dry-run");

type Job = { name: string; due: number; run: () => Promise<void> };
type SubstackFeed = { creator: RankedCreator; wait: number; due: number; etag?: string };

let walked: RankedCreator[] = [];
const substackFeeds = new Map<string, SubstackFeed>();
/** When each walked forum author was last listed on their own profile. */
const authorListedAt = new Map<string, number>();
let lastSubstackReadAt = 0;
let youtubeFirstPass = true;
let quotaLogged = false;

async function refreshRanking(): Promise<void> {
  walked = (await rankCreators()).slice(0, MAX_WALKED_CREATORS);
  const rank = (c: RankedCreator) => (c.prioritized ? PRIORITY_RANK : 0) + c.walkScore;
  const changed = dryRun ? 0 : await setListRanks(walked.map((c) => ({ feed_url: c.feed_url, rank: rank(c) })));
  const substacks = walked.filter((c) => c.feed_type === "substack");
  const waits = feedWaits(substacks.map((c) => ({ feedUrl: c.feed_url, score: c.walkScore, prioritized: c.prioritized })));
  const now = Date.now();
  for (const url of substackFeeds.keys()) if (!substacks.some((c) => c.feed_url === url)) substackFeeds.delete(url);
  for (const creator of substacks) {
    const wait = waits.get(creator.feed_url)!;
    const known = substackFeeds.get(creator.feed_url);
    substackFeeds.set(creator.feed_url, known ? { ...known, creator, wait } : { creator, wait, due: now });
  }
  const kinds = (kind: RankedCreator["feed_type"]) => walked.filter((c) => c.feed_type === kind).length;
  console.log(
    `[walk] walking ${walked.length} creators: ${kinds("youtube")} YouTube channels, ${kinds("lesswrong")} forum authors, ${kinds("substack")} Substacks · ${changed} list ranks changed`,
  );
}

async function readNextSubstack(feed: SubstackFeed): Promise<void> {
  const sinceLast = Date.now() - lastSubstackReadAt;
  if (sinceLast < MIN_SECONDS_BETWEEN_SITE_READS * 1000) await Bun.sleep(MIN_SECONDS_BETWEEN_SITE_READS * 1000 - sinceLast);
  lastSubstackReadAt = Date.now();
  feed.due = nextDue(feed.due, feed.wait, Date.now());
  try {
    const read = await readFeedIfChanged(feed.creator.feed_url, feed.etag);
    if (read.kind === "not_modified") return;
    feed.etag = read.etag ?? undefined;
    await addNewPosts(feed.creator, read.feed.title, substackEntries(read.feed.posts), dryRun);
  } catch (err) {
    console.log(`[walk] could not read the feed of ${feed.creator.project_slug}: ${(err as Error).message}`);
  }
}

async function readForums(): Promise<void> {
  const authors = walked.filter((c) => c.feed_type === "lesswrong");
  const origins = [...new Set(authors.map((c) => forumOrigin(c.feed_url)).filter((o): o is string => o !== null))];
  for (const origin of origins) {
    let posts;
    try {
      posts = await readForumNewestPosts(origin, FORUM_NEWEST_POSTS);
    } catch (err) {
      console.log(`[walk] could not read the newest posts of ${origin}: ${(err as Error).message}`);
      continue;
    }
    for (const author of authors) {
      const feed = parseAuthorFeedUrl(author.feed_url);
      if (feed?.origin !== origin) continue;
      const theirs = posts.filter((p) => p.authorSlug?.toLowerCase() === feed.slug.toLowerCase());
      if (theirs.length) await addNewPosts(author, undefined, forumEntries(theirs), dryRun);
    }
  }
  await listOneForumAuthor(authors);
}

/** Lists the walked forum author whose own profile was listed longest ago.
 *  A post found here was missed by the newest-posts query, which the log
 *  names, so a few days of logs show whether the per-author listings can go. */
async function listOneForumAuthor(authors: RankedCreator[]): Promise<void> {
  const author = authors.sort((a, b) => (authorListedAt.get(a.feed_url) ?? 0) - (authorListedAt.get(b.feed_url) ?? 0))[0];
  if (!author) return;
  authorListedAt.set(author.feed_url, Date.now());
  try {
    const listing = await readForumListing(author.feed_url, LISTING_POSTS);
    const added = await addNewPosts(author, listing.authorName ?? undefined, forumEntries(listing.posts), dryRun);
    if (added > 0) console.log(`[walk] the newest-posts query missed ${added} posts of ${author.project_slug}, which their own listing found`);
  } catch (err) {
    console.log(`[walk] could not list ${author.project_slug}: ${(err as Error).message}`);
  }
}

/** Lists every channel that is due. The first pass after a start also adds
 *  the uploads of every stored listing, which the old walk took only one at
 *  a time. */
async function readYoutube(): Promise<void> {
  // A listing writes the channel's row and subscribes it at the hub, so a dry
  // run leaves YouTube out.
  if (dryRun) return;
  if (quotaRanOutThisRun()) {
    if (!quotaLogged) console.log("[walk] the YouTube Data API quota is used up until 07:00 UTC, so no channel is listed until then");
    quotaLogged = true;
    return;
  }
  quotaLogged = false;
  const now = new Date();
  const states = new Map((await fetchYoutubeChannelStates()).map((row) => [row.feed_url, row]));
  for (const channel of walked.filter((c) => c.feed_type === "youtube")) {
    if (!youtubeFirstPass && !channelDue(states.get(channel.feed_url), now)) continue;
    try {
      const { title, uploads } = await youtubeChannelUploads(channel.feed_url, LISTING_POSTS);
      await addNewPosts(channel, title, youtubeEntries(uploads), dryRun);
    } catch (err) {
      if (err instanceof YoutubeQuotaExceededError) return readYoutube();
      console.log(`[walk] could not list ${channel.project_slug}: ${(err as Error).message}`);
    }
  }
  youtubeFirstPass = false;
}

/** Puts back the posts the intake service could not read whose rest time is
 *  over. A source whose every read failed in the last hour gets only a few. */
async function retryUnreadPosts(): Promise<void> {
  const failing = failingSources(await fetchItemOutcomesSince(new Date(Date.now() - FAILING_SOURCE_WINDOW_MS)));
  const retried = new Map<string, number>();
  for (const item of await fetchRetryableErrorItems(RETRY_WAIT_HOURS)) {
    const count = retried.get(item.source) ?? 0;
    if (failing.has(item.source) && count >= RETRIES_PER_FAILING_SOURCE) continue;
    retried.set(item.source, count + 1);
    await requeueErroredItem(item);
    console.log(`[walk] back for attempt ${attemptLabel(item)}: ${item.url}`);
  }
}

async function tidy(): Promise<void> {
  const { expired, closed } = await tidyList();
  if (expired || closed) console.log(`[walk] tidied the list: ${expired} reservations past their deadline ended, ${closed} posts turned 14 days old`);
  await refreshStaleAvatars(AVATARS_PER_RUN);
  await watchNotewriterSilence();
  await queueDemandedPages();
  await retryUnreadPosts();
}

function every(name: string, ms: number, run: () => Promise<void>): Job {
  const job: Job = {
    name,
    due: Date.now(),
    run: async () => {
      job.due = Date.now() + ms;
      await run();
    },
  };
  return job;
}

async function main() {
  await refreshRanking();
  const jobs = [
    every("ranking", RANKING_EVERY_MS, refreshRanking),
    every("forums", FORUMS_EVERY_MS, readForums),
    every("youtube", YOUTUBE_EVERY_MS, readYoutube),
    ...(dryRun ? [] : [every("tidy", TIDY_EVERY_MS, tidy)]),
  ];
  jobs[0]!.due = Date.now() + RANKING_EVERY_MS;
  console.log(`[walk] started${dryRun ? " as a dry run: nothing is written" : ""}`);
  for (;;) {
    const job = jobs.reduce((a, b) => (b.due < a.due ? b : a));
    const feed = [...substackFeeds.values()].reduce<SubstackFeed | undefined>((a, b) => (!a || b.due < a.due ? b : a), undefined);
    const due = Math.min(job.due, feed?.due ?? Infinity);
    await Bun.sleep(Math.max(0, due - Date.now()));
    if (feed && feed.due <= job.due) await readNextSubstack(feed);
    else await job.run();
  }
}

main().catch((err) => {
  console.error("[walk] Fatal error:", err);
  process.exit(1);
});
