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
 * neither set is not walked at all, so attention that fades takes its spend
 * with it.
 *
 * Both sides are needed because a creator nobody has ever checked has no row
 * anywhere. Prioritised creators are project rows; read creators are
 * aggregated out of the anonymous visit rows the extension writes, and most of
 * them have no project yet. Creating a project for every creator anyone visits
 * would fill the public projects table with creators we have never checked, so
 * a project row is made at the moment a creator is pressed or their first item
 * is ingested, and not before.
 *
 * WHAT "READ THEM" MEANS, and why there are two answers (GOO-135). A visit row
 * carries a reader hash: one value per browser and per creator, so the database
 * can count how many different people read a creator without ever being able to
 * join one person's reading across creators. The rule we want is about people:
 * a creator is walked once at least one reader has opened at least two
 * different pages of theirs. Rows written before that hash existed carry none,
 * and neither do rows from extension copies that never updated, so applying the
 * rule straight away would drop every creator off the walk on the day it ships.
 *
 * So the walk waits for proof that the counting works: has any single creator
 * ever been visited by two different readers? Until that is true it keeps the
 * old rule, counting visit rows and ignoring who wrote them. From the moment it
 * is true the reader rule governs and rows without a hash stop counting for
 * anything the decision uses. The proof is asked over all history, so it flips
 * once and never flips back.
 */

import { fetchCreatorProjects, fetchCreatorAttention, fetchTwoReadersSeen, QUEUE_PRIORITY } from "./db";
import { canonicalFeed, type FeedType } from "./feedUrls";
import { normalizeFeedUrl } from "../everything-shared/pageUrls";

export const VISIT_RANKING_WINDOW_DAYS = 14;

/** How many different pages of one creator a reader must open inside the window
 *  before they count as a regular reader of that creator. One page is a click;
 *  a second, different page is somebody who reads them. */
export const MIN_PAGES_FOR_A_REGULAR_READER = 2;

/** How many regular readers a creator needs before we walk them on attention
 *  alone. Raise this to two when enough people use the extension for that to
 *  mean something. A creator holding priority is walked whatever their readers,
 *  because someone asked for them. */
export const MIN_REGULAR_READERS_TO_WALK_CREATOR = 1;

/** The rule that applied before the reader hash existed, and that still applies
 *  until the two-reader proof arrives: how many visit rows inside the window a
 *  creator needs, counted without regard to who wrote them. */
export const MIN_VISITS_TO_WALK_CREATOR = 2;

/** Which of the two rules a run used. The auto-enqueue prints it, so a walk's
 *  output is never ambiguous about how its numbers were produced. */
export type RankingRule = "readers" | "visits";

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
  /** Different readers inside the window. */
  readers: number;
  /** Readers who opened at least MIN_PAGES_FOR_A_REGULAR_READER different
   *  pages. Under the reader rule this is what the order is built on. */
  regularReaders: number;
  /** When this creator's top posts were last recomputed (GOO-81). */
  top_posts_refreshed_at: string | null;
}

const isOpen = (priorityUntil: string | null): boolean =>
  priorityUntil != null && Date.parse(priorityUntil) > Date.now();

const qualifies = (creator: RankedCreator, rule: RankingRule): boolean =>
  rule === "readers"
    ? creator.regularReaders >= MIN_REGULAR_READERS_TO_WALK_CREATOR
    : creator.visits >= MIN_VISITS_TO_WALK_CREATOR;

/** Most attention first. Under the reader rule the primary number is people;
 *  different pages breaks the ties, which today is most of them, because it
 *  measures how much of a creator is being read and a reloaded page cannot
 *  inflate it. Before the proof this is the old order, on visit rows alone.
 *  Both end on the feed address, so a tie sorts the same way on every run
 *  rather than depending on how the database returned the rows. */
const byAttention = (rule: RankingRule) => (a: RankedCreator, b: RankedCreator) =>
  Number(b.prioritized) - Number(a.prioritized) ||
  (rule === "readers" ? b.regularReaders - a.regularReaders || b.pages - a.pages : b.visits - a.visits) ||
  a.feed_url.localeCompare(b.feed_url);

/** Every creator the auto-enqueue should walk, most important first. */
export async function rankCreators(): Promise<{ creators: RankedCreator[]; rule: RankingRule }> {
  const since = new Date(Date.now() - VISIT_RANKING_WINDOW_DAYS * 24 * 3600_000);
  const [projects, attention, twoReadersSeen] = await Promise.all([
    fetchCreatorProjects(),
    fetchCreatorAttention(since, MIN_PAGES_FOR_A_REGULAR_READER),
    fetchTwoReadersSeen(),
  ]);
  const rule: RankingRule = twoReadersSeen ? "readers" : "visits";

  // The database already groups creators case-insensitively, so there is one
  // row per creator here. The key is normalized again because the same creator
  // has to be found from a project row too, and a project stores whatever
  // casing it was created with.
  const attentionByUrl = new Map(attention.map((a) => [normalizeFeedUrl(a.feed_url), a]));
  const nothingRead = { visits: 0, pages: 0, readers: 0, regular_readers: 0 };

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
    const read = attentionByUrl.get(normalizeFeedUrl(p.feed_url)) ?? nothingRead;
    ranked.push({
      project_slug: p.project_slug,
      feed_type: feed.feed_type,
      feed_url: p.feed_url,
      priority: QUEUE_PRIORITY.prioritized,
      prioritized: true,
      priorityUntil: p.priority_until,
      visits: read.visits,
      pages: read.pages,
      readers: read.readers,
      regularReaders: read.regular_readers,
      top_posts_refreshed_at: p.top_posts_refreshed_at,
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
      regularReaders: read.regular_readers,
      // A creator with no project yet has no refresh stamp, so their top posts
      // are computed the first time they are walked.
      top_posts_refreshed_at: known?.top_posts_refreshed_at ?? null,
    };
    if (qualifies(creator, rule)) ranked.push(creator);
  }

  ranked.sort(byAttention(rule));
  return { creators: ranked, rule };
}
