/**
 * Adds pages to the post list because readers open them (GOO-793).
 *
 * A visit used to feed only its creator's score, so a page several readers
 * opened was checked only if the walk happened to reach it or someone pressed
 * "request notes". cn-walk takes each page without an item that enough
 * different readers opened in the last 7 days (everything_demanded_pages,
 * migration 183) and adds it with demanded_at set. In the list's order such a
 * page ranks like a post of a creator holding priority, whatever its
 * publication day, and it stays listed for 14 days from then (migration 184).
 *
 * A page is taken once. everything_demand_queued keeps it, so a page whose
 * check failed or was skipped is not added again. A page that could not be
 * read gets the same repeat attempts as any post cn-walk added: three, and
 * more while its source cannot be reached (fetchRetryableErrorItems).
 */

import { classifyRequestSource, projectForRequest } from "./consumeRequests";
import {
  fetchDemandedListed,
  fetchDemandedPages,
  fetchDemandReport,
  fetchItemOutcomesSince,
  findItemForPageUrl,
  insertQueuedItem,
  markItemDemanded,
  recordDemandQueued,
  type DemandedPage,
} from "./db";
import { FAILING_SOURCE_WINDOW_MS, failingSources } from "./retries";

type Kind = DemandedPage["kind"];

/** The bars and daily caps, each a variable of cn-walk's environment on the
 *  services box (ops/cn-walk.service). A bar or a cap of 0 switches that kind
 *  off. Videos need more readers than text
 *  posts: at 3 readers a queued video drew no more later readers than a walk
 *  post (0.79 against 0.83 over 10 days to 2026-11-17), at 5 it drew 1.39.
 *  A post already waiting on the list moves up at its second reader: replayed
 *  on 2026-11-19 to 11-23 that moved 4 text posts and 23 videos a day, which 15
 *  later readers a day opened, and the posts they put back drew 0.06 each. */
const DEFAULTS = { textReaders: 3, textDailyCap: 20, youtubeReaders: 5, youtubeDailyCap: 20, listedTextReaders: 2, listedYoutubeReaders: 2 };

/** An unset or unreadable variable means the default; "0" means off. */
export function setting(raw: string | undefined, fallback: number): number {
  const value = raw?.trim() ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function demandSettings(env: Record<string, string | undefined> = process.env): Record<Kind, { readers: number; listedReaders: number; dailyCap: number }> {
  return {
    text: {
      readers: setting(env.EVERYTHING_DEMAND_TEXT_READERS, DEFAULTS.textReaders),
      listedReaders: setting(env.EVERYTHING_DEMAND_LISTED_TEXT_READERS, DEFAULTS.listedTextReaders),
      dailyCap: setting(env.EVERYTHING_DEMAND_TEXT_DAILY_CAP, DEFAULTS.textDailyCap),
    },
    youtube: {
      readers: setting(env.EVERYTHING_DEMAND_YOUTUBE_READERS, DEFAULTS.youtubeReaders),
      listedReaders: setting(env.EVERYTHING_DEMAND_LISTED_YOUTUBE_READERS, DEFAULTS.listedYoutubeReaders),
      dailyCap: setting(env.EVERYTHING_DEMAND_YOUTUBE_DAILY_CAP, DEFAULTS.youtubeDailyCap),
    },
  };
}

const KINDS: Kind[] = ["text", "youtube"];
const NAME: Record<Kind, string> = { text: "text posts", youtube: "videos" };
/** The item source each kind is queued as (classifyRequestSource). */
const SOURCE: Record<Kind, string> = { text: "web", youtube: "youtube" };

/** Queues the pages readers opened and moves up the waiting posts they
 *  opened, up to each kind's daily cap, which both share. Returns how many it
 *  queued or moved up. */
export async function queueDemandedPages(settings = demandSettings()): Promise<number> {
  console.log("\nREADER DEMAND · pages without notes that several readers opened in the last 7 days");
  const report = await fetchDemandReport();
  const left = {} as Record<Kind, number>;
  for (const kind of KINDS) {
    const row = report.find((r) => r.kind === kind);
    const { readers, listedReaders, dailyCap } = settings[kind];
    left[kind] = Math.max(0, dailyCap - (row?.queued_24h ?? 0));
    const bars = [readers > 0 ? `from ${readers} readers` : "", listedReaders > 0 ? `already listed from ${listedReaders}` : ""].filter(Boolean).join(", ");
    const state = !bars || dailyCap === 0 ? "off" : `${bars} · ${row?.queued_24h ?? 0} of ${dailyCap} queued in the last 24 h`;
    // What became of the pages queued 2 to 9 days ago is what the bars and
    // caps are tuned by, above all for videos, many of which are music.
    const outcome = row?.settled ? ` · of ${row.settled} queued 2 to 9 days ago, ${row.checked} were checked and ${row.with_notes} got a note` : "";
    console.log(`  ${NAME[kind]}: ${state}${outcome}`);
  }
  // A source whose every read failed in the last hour gets no new pages. On 2026-11-17 the proxy YouTube is
  // read through ran out of traffic, and the first 20 videos queued here all
  // failed within a minute.
  const failing = failingSources(await fetchItemOutcomesSince(new Date(Date.now() - FAILING_SOURCE_WINDOW_MS)));
  for (const kind of KINDS) {
    if (!failing.has(SOURCE[kind])) continue;
    left[kind] = 0;
    console.log(`  ${NAME[kind]}: passed over, every one read in the last hour failed`);
  }
  if (KINDS.every((kind) => left[kind] === 0)) return 0;

  const bar = (kind: Kind, readers: number) => (left[kind] > 0 && readers > 0 ? readers : null);
  const pages = await fetchDemandedPages(bar("text", settings.text.readers), bar("youtube", settings.youtube.readers));
  let queued = 0;
  for (const page of pages) {
    if (left[page.kind] === 0) continue;
    // The database matched the page against every item's address. A video's
    // stored address can still be spelled in a way that match misses.
    const existing = await findItemForPageUrl(page.page_url);
    // Recorded before it is queued, and a failure here ends the pass: a page
    // the log does not hold would be offered again, and the daily cap, which
    // counts the log, would stop nothing.
    await recordDemandQueued({ page_url: page.page_url, kind: page.kind, readers: page.readers, queued: !existing });
    if (existing) continue;
    left[page.kind]--;
    try {
      await insertQueuedItem({
        project_id: await projectForRequest(page),
        source: classifyRequestSource(page.page_url),
        url: page.page_url,
        demanded_at: new Date().toISOString(),
        checked_scope: "page",
      });
      queued++;
      console.log(`  queued, ${page.readers} readers: ${page.page_url}`);
    } catch (err: any) {
      // One page that cannot be added must not stop the walk. It stays
      // recorded, so it is not tried again.
      console.log(`  could not queue ${page.page_url}: ${err?.message ?? "unknown error"}`);
    }
  }
  queued += await moveUpListedPosts(bar("text", settings.text.listedReaders), bar("youtube", settings.youtube.listedReaders), left);
  if (queued === 0) console.log("  nothing new to queue");
  return queued;
}

/** Moves up the posts that wait on the list while readers open them
 *  (everything_demanded_listed, migration 199). Since cn-walk lists every
 *  known creator's posts, most pages readers open already have an item, which
 *  the rule above never takes. */
async function moveUpListedPosts(textReaders: number | null, youtubeReaders: number | null, left: Record<Kind, number>): Promise<number> {
  if (textReaders === null && youtubeReaders === null) return 0;
  const posts = await fetchDemandedListed(textReaders, youtubeReaders);
  if (posts === null) {
    console.log("  waiting posts are not moved up: migration 199 is not applied");
    return 0;
  }
  let moved = 0;
  for (const post of posts) {
    if (left[post.kind] === 0) continue;
    // Recorded first, as above, so the daily cap always holds.
    await recordDemandQueued({ page_url: post.page_url, kind: post.kind, readers: post.readers, queued: true });
    left[post.kind]--;
    try {
      await markItemDemanded(post.item_id);
      moved++;
      console.log(`  moved up, ${post.readers} readers: ${post.page_url}`);
    } catch (err: any) {
      console.log(`  could not move up ${post.page_url}: ${err?.message ?? "unknown error"}`);
    }
  }
  return moved;
}
