/**
 * Queues pages for notes because readers open them (GOO-793).
 *
 * A visit used to feed only its creator's score, so a page several readers
 * opened was checked only if the walk happened to reach it or someone pressed
 * "request notes". The feed run now takes each page without an item that
 * enough different readers opened in the last 7 days
 * (everything_demanded_pages, migration 183) and queues it the way a reader
 * request is queued, one tier lower: behind real requests, ahead of the
 * backlog walk. A notewriter takes it as a feed post, at its own pace, so
 * these pages replace walk posts and add no writer runs.
 *
 * A page is taken once. everything_demand_queued keeps it, so a page whose
 * check failed or was skipped is not queued again. A page that could not be
 * read gets the same repeat attempts as any failed post: three, and more
 * while its source cannot be reached (fetchRetryableErrorItems).
 */

import { attemptLabel, FAILING_SOURCE_WINDOW_MS, failingSources, RETRY_WAIT_HOURS } from "./autoEnqueue";
import { classifyRequestSource, projectForRequest } from "./consumeRequests";
import {
  fetchDemandedPages,
  fetchDemandQueuedUrls,
  fetchDemandReport,
  fetchItemOutcomesSince,
  fetchRetryableErrorItems,
  findItemForPageUrl,
  insertQueuedItem,
  QUEUE_PRIORITY,
  recordDemandQueued,
  requeueErroredItem,
  type DemandedPage,
} from "./db";

type Kind = DemandedPage["kind"];

/** The bars and daily caps, each a repo variable of the feed workflow. A bar
 *  or a cap of 0 switches that kind off. Videos need more readers than text
 *  posts: at 3 readers a queued video drew no more later readers than a walk
 *  post (0.79 against 0.83 over 10 days to 2026-11-17), at 5 it drew 1.39. */
const DEFAULTS = { textReaders: 3, textDailyCap: 20, youtubeReaders: 5, youtubeDailyCap: 20 };

/** An unset or unreadable variable means the default; "0" means off. */
export function setting(raw: string | undefined, fallback: number): number {
  const value = raw?.trim() ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function demandSettings(env: Record<string, string | undefined> = process.env): Record<Kind, { readers: number; dailyCap: number }> {
  return {
    text: {
      readers: setting(env.EVERYTHING_DEMAND_TEXT_READERS, DEFAULTS.textReaders),
      dailyCap: setting(env.EVERYTHING_DEMAND_TEXT_DAILY_CAP, DEFAULTS.textDailyCap),
    },
    youtube: {
      readers: setting(env.EVERYTHING_DEMAND_YOUTUBE_READERS, DEFAULTS.youtubeReaders),
      dailyCap: setting(env.EVERYTHING_DEMAND_YOUTUBE_DAILY_CAP, DEFAULTS.youtubeDailyCap),
    },
  };
}

const KINDS: Kind[] = ["text", "youtube"];
const NAME: Record<Kind, string> = { text: "text posts", youtube: "videos" };
/** The item source each kind is queued as (classifyRequestSource). */
const SOURCE: Record<Kind, string> = { text: "web", youtube: "youtube" };

/** How many failed pages of one source get a repeat attempt per feed run. Two
 *  failures are what marks a source as failing, so when a source is down, two
 *  pages an hour spend an attempt, not all of them at once. */
const RETRIES_PER_SOURCE_PER_RUN = 2;

/** Gives failed pages of this rule their repeat attempts, on the walk's
 *  schedule. The walk retries a failed post only when it walks the post's
 *  creator, and most of these pages belong to creators it does not walk. */
async function retryDemandedPages(failing: Set<string>): Promise<void> {
  const due = (await fetchRetryableErrorItems(RETRY_WAIT_HOURS, "feed")).filter((item) => !failing.has(classifyRequestSource(item.url)));
  if (due.length === 0) return;
  const ours = await fetchDemandQueuedUrls(due.map((item) => item.url));
  const retried = new Map<string, number>();
  for (const item of due) {
    const source = classifyRequestSource(item.url);
    if (!ours.has(item.url) || (retried.get(source) ?? 0) >= RETRIES_PER_SOURCE_PER_RUN) continue;
    retried.set(source, (retried.get(source) ?? 0) + 1);
    await requeueErroredItem(item, item.priority);
    console.log(`  failed page back in the queue, attempt ${attemptLabel(item)}: ${item.url}`);
  }
}

/** Queues the pages readers opened, up to each kind's daily cap. Returns how
 *  many it queued. */
export async function queueDemandedPages(settings = demandSettings()): Promise<number> {
  console.log("\nREADER DEMAND · pages without notes that several readers opened in the last 7 days");
  const report = await fetchDemandReport();
  const left = {} as Record<Kind, number>;
  for (const kind of KINDS) {
    const row = report.find((r) => r.kind === kind);
    const { readers, dailyCap } = settings[kind];
    left[kind] = readers > 0 ? Math.max(0, dailyCap - (row?.queued_24h ?? 0)) : 0;
    const state = readers === 0 || dailyCap === 0 ? "off" : `from ${readers} readers · ${row?.queued_24h ?? 0} of ${dailyCap} queued in the last 24 h`;
    // What became of the pages queued 2 to 9 days ago is what the bars and
    // caps are tuned by, above all for videos, many of which are music.
    const outcome = row?.settled ? ` · of ${row.settled} queued 2 to 9 days ago, ${row.checked} were checked and ${row.with_notes} got a note` : "";
    console.log(`  ${NAME[kind]}: ${state}${outcome}`);
  }
  // A source whose every read failed in the last hour gets no new pages and
  // no repeat attempts, as in the walk. On 2026-11-17 the proxy YouTube is
  // read through ran out of traffic, and the first 20 videos queued here all
  // failed within a minute.
  const failing = failingSources(await fetchItemOutcomesSince(new Date(Date.now() - FAILING_SOURCE_WINDOW_MS)));
  for (const kind of KINDS) {
    if (!failing.has(SOURCE[kind])) continue;
    left[kind] = 0;
    console.log(`  ${NAME[kind]}: passed over, every one read in the last hour failed`);
  }
  await retryDemandedPages(failing);
  if (KINDS.every((kind) => left[kind] === 0)) return 0;

  const pages = await fetchDemandedPages(left.text > 0 ? settings.text.readers : null, left.youtube > 0 ? settings.youtube.readers : null);
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
        priority: QUEUE_PRIORITY.prioritized,
        checked_scope: "page",
      });
      queued++;
      console.log(`  queued, ${page.readers} readers: ${page.page_url}`);
    } catch (err: any) {
      // One page that cannot be queued must not stop the feed run. It stays
      // recorded, so it is not tried again.
      console.log(`  could not queue ${page.page_url}: ${err?.message ?? "unknown error"}`);
    }
  }
  if (queued === 0) console.log("  nothing new to queue");
  return queued;
}
