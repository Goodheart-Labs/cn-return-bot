/**
 * Ranks the creators the auto-enqueue walks, so the daily budget follows
 * reader attention (GOO-60, reworked by GOO-107 and GOO-135).
 *
 * There are exactly two reasons to walk a creator, and nothing is permanent:
 *
 *   1. They hold priority. Someone pressed the button in the extension, or ran
 *      everything-prioritize. That lasts seven days and then lapses.
 *   2. Readers read them inside the ranking window.
 *
 * Prioritised creators come first, then everyone by attention. A creator in
 * neither set is not ranked at all, so attention that fades takes its spend
 * with it. Attention has a floor, one reader, below which a creator
 * is not walked however much money is left. Above the floor, how far down
 * the list the walk goes is decided by the budget, in autoEnqueue.ts, so more
 * money per day admits creators further down and less money raises the bar.
 *
 * Both sides are needed because a creator nobody has ever checked has no row
 * anywhere. Prioritised creators are project rows; read creators are
 * aggregated out of the anonymous visit rows the extension writes, and most of
 * them have no project yet. Creating a project for every creator anyone visits
 * would fill the public projects table with creators we have never checked, so
 * a project row is made at the moment a creator is pressed or their first item
 * is ingested, and not before.
 *
 * WHAT "READ THEM" MEANS (GOO-135, GOO-182). A visit row carries a reader
 * hash: one value per browser and per creator, so the database can count how
 * many different browsers read a creator without ever being able to join one
 * person's reading across creators. A reader of a creator is a browser that
 * opened at least two different pages of theirs inside the window. One page is
 * a click, not a reader. Rows without a reader hash, written before the hash
 * existed or by extension copies that never updated, count for nothing here.
 */

import { fetchCreatorProjects, fetchCreatorAttention, QUEUE_PRIORITY } from "./db";
import { canonicalFeed, type FeedType } from "./feedUrls";
import { normalizeFeedUrl } from "../everything-shared/pageUrls";
import { MIN_PAGES_FOR_A_READER, MIN_READERS_TO_WALK_CREATOR, VISIT_RANKING_WINDOW_DAYS } from "../everything-shared/readers";

export interface RankedCreator {
  project_slug: string;
  /** Derived from the URL at read time, never stored, so it cannot drift. */
  feed_type: FeedType;
  feed_url: string;
  /** The QUEUE_PRIORITY tier this creator's items enqueue at. */
  priority: number;
  /** True while the creator's priority window is open. Such a creator ranks
   *  strictly above every creator walked on attention alone. */
  prioritized: boolean;
  /** When the priority window runs out, for the run log. Null when the creator
   *  is walked on attention alone. */
  priorityUntil: string | null;
  /** Every visit row inside the window, whoever wrote it. */
  visits: number;
  /** Different pages opened inside the window, over rows with a reader hash. */
  pages: number;
  /** Browsers that opened at least MIN_PAGES_FOR_A_READER different pages.
   *  This is what the order is built on. */
  readers: number;
  /** When this creator's top posts were last recomputed (GOO-81). */
  top_posts_refreshed_at: string | null;
  /** When a refresh was last tried and failed (migration 101). */
  top_posts_attempted_at: string | null;
}

const isOpen = (priorityUntil: string | null): boolean =>
  priorityUntil != null && Date.parse(priorityUntil) > Date.now();

/** The floor: at least one reader. A creator below it is not walked at all,
 *  whatever the budget. How far down the list above the floor the walk goes is
 *  not decided here: the auto-enqueue admits creators from the top until what
 *  they publish per day fills the paced budget (see admitCreators in
 *  autoEnqueue.ts). */
const qualifies = (creator: RankedCreator): boolean => creator.readers >= MIN_READERS_TO_WALK_CREATOR;

/** Most attention first. The primary number is readers. Different pages breaks
 *  the ties, which today is most of them, because it measures how much of a
 *  creator is being read and a reloaded page cannot inflate it. The order ends
 *  on the feed address, so a tie sorts the same way on every run rather than
 *  depending on how the database returned the rows. */
const byAttention = (a: RankedCreator, b: RankedCreator) =>
  Number(b.prioritized) - Number(a.prioritized) ||
  b.readers - a.readers ||
  b.pages - a.pages ||
  a.feed_url.localeCompare(b.feed_url);

/** Every creator with priority or attention, most important first. The
 *  auto-enqueue walks a prefix of this list, as far as the budget reaches. */
export async function rankCreators(): Promise<RankedCreator[]> {
  const since = new Date(Date.now() - VISIT_RANKING_WINDOW_DAYS * 24 * 3600_000);
  const [projects, attention] = await Promise.all([
    fetchCreatorProjects(),
    fetchCreatorAttention(since, MIN_PAGES_FOR_A_READER),
  ]);

  // The database already groups creators case-insensitively, so there is one
  // row per creator here. The key is normalized again because the same creator
  // has to be found from a project row too, and a project stores whatever
  // casing it was created with.
  const attentionByUrl = new Map(attention.map((a) => [normalizeFeedUrl(a.feed_url), a]));

  // Known creators are indexed by feed URL rather than by slug. The URL is the
  // key everything shares, and it is what keeps a creator walked on attention
  // alone attached to the project their notes already live in, even when that
  // project's slug carries a collision suffix.
  const knownByUrl = new Map(projects.map((p) => [normalizeFeedUrl(p.feed_url), p]));

  const ranked: RankedCreator[] = [];
  for (const p of projects.filter((p) => isOpen(p.priority_until))) {
    // The shape CHECK on the column should make this impossible; if it ever
    // happens the walk says so rather than guessing a feed type.
    const feed = canonicalFeed(p.feed_url);
    if (!feed) {
      console.warn(`  skipping ${p.project_slug}: stored feed url is not a shape we can walk (${p.feed_url})`);
      continue;
    }
    const read = attentionByUrl.get(normalizeFeedUrl(p.feed_url));
    ranked.push({
      project_slug: p.project_slug,
      feed_type: feed.feed_type,
      feed_url: p.feed_url,
      priority: QUEUE_PRIORITY.prioritized,
      prioritized: true,
      priorityUntil: p.priority_until,
      visits: read?.visits ?? 0,
      pages: read?.pages ?? 0,
      readers: read?.readers ?? 0,
      top_posts_refreshed_at: p.top_posts_refreshed_at,
      top_posts_attempted_at: p.top_posts_attempted_at,
    });
  }
  const alreadyRanked = new Set(ranked.map((c) => normalizeFeedUrl(c.feed_url)));

  for (const [key, read] of attentionByUrl) {
    if (alreadyRanked.has(key)) continue;
    // A captured feed URL of an unknown shape, or a corrupted old row, is
    // skipped rather than walked blindly. The pipeline has no other way to tell
    // what kind of feed it is, since the type is derived from the URL.
    const feed = canonicalFeed(read.feed_url);
    if (!feed) {
      console.warn(`  skipping a visited creator: feed url is not a shape we can walk (${read.feed_url})`);
      continue;
    }
    const known = knownByUrl.get(key);
    const creator: RankedCreator = {
      project_slug: known?.project_slug ?? feed.project_slug,
      feed_type: feed.feed_type,
      feed_url: known?.feed_url ?? feed.feed_url,
      priority: QUEUE_PRIORITY.backlog,
      prioritized: false,
      priorityUntil: null,
      visits: read.visits,
      pages: read.pages,
      readers: read.readers,
      // A creator with no project yet has no refresh stamp, so their top posts
      // are computed the first time they are walked.
      top_posts_refreshed_at: known?.top_posts_refreshed_at ?? null,
      top_posts_attempted_at: known?.top_posts_attempted_at ?? null,
    };
    if (qualifies(creator)) ranked.push(creator);
  }

  ranked.sort(byAttention);
  return ranked;
}
