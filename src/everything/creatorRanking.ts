/**
 * Ranks the creators the auto-enqueue walks, so the daily budget follows
 * reader attention (GOO-60, reworked by GOO-107, GOO-135 and GOO-257).
 *
 * There are exactly two reasons to walk a creator:
 *
 *   1. They hold priority. Someone pressed the button in the extension, or ran
 *      everything-prioritize. That lasts seven days and then lapses.
 *   2. People with the extension opened at least two different posts of
 *      theirs, at any time.
 *
 * Prioritised creators come first, then everyone else by their score. The walk
 * in autoEnqueue.ts goes down this list from the top and stops at the first
 * creator with a post we have not checked.
 *
 * Both sides are needed because a creator nobody has ever checked has no row
 * anywhere. Prioritised creators are project rows; visited creators are
 * aggregated out of the anonymous visit rows the extension writes, and most of
 * them have no project yet. Creating a project for every creator anyone visits
 * would fill the public projects table with creators we have never checked, so
 * a project row is made at the moment a creator is pressed or their first item
 * is ingested, and not before.
 *
 * THE SCORE (GOO-257). A creator's score is the average number of different
 * people per post, over the creator's 10 most recently visited posts. A visit
 * row carries a reader hash: one value per browser and per creator, so the
 * database can count different people without ever being able to join one
 * person's reading across creators. Rows without a reader hash, written before
 * the hash existed or by extension copies that never updated, count for
 * nothing. The score has no time window, so a creator who posts once a month
 * is not forgotten between posts. It is an average rather than a total, so a
 * creator who posts rarely but is widely read ranks above one who posts daily
 * to a few people, and one person binge-watching a channel adds only about one
 * person to each video.
 *
 * A creator needs at least two visited posts to be walked on visits. One post
 * that a few people opened, perhaps because someone shared the link, says
 * little about the creator's next post.
 */

import { fetchCreatorProjects, fetchCreatorVisitScores, QUEUE_PRIORITY, type CreatorVisitScore } from "./db";
import { canonicalFeed, type FeedType } from "./feedUrls";
import { normalizeFeedUrl } from "../everything-core/pageUrls";
import { LAST_POSTS_PER_CREATOR } from "../everything-core/readers";

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
  /** The creator's score and what it is made of. All zero for a prioritised
   *  creator nobody has visited. */
  score: Omit<CreatorVisitScore, "feed_url">;
  /** When this creator's top posts were last recomputed (GOO-81). */
  top_posts_refreshed_at: string | null;
  /** When a refresh was last tried and failed (migration 101). */
  top_posts_attempted_at: string | null;
}

const isOpen = (priorityUntil: string | null): boolean =>
  priorityUntil != null && Date.parse(priorityUntil) > Date.now();

/** How many different posts of a creator must have been opened before the
 *  creator is walked on visits alone. A prioritised creator is walked
 *  whatever their visits, because someone asked for them. */
const MIN_VISITED_POSTS_TO_WALK = 2;

const NO_VISITS: RankedCreator["score"] = { visitors_per_post: 0, posts: 0, people: 0 };

/** Prioritised creators first, then the highest score. Among equal scores,
 *  the creator more different people visited goes first. The order ends on
 *  the feed address, so a tie sorts the same way on every run rather than
 *  depending on how the database returned the rows. */
const byPriorityThenScore = (a: RankedCreator, b: RankedCreator) =>
  Number(b.prioritized) - Number(a.prioritized) ||
  b.score.visitors_per_post - a.score.visitors_per_post ||
  b.score.people - a.score.people ||
  a.feed_url.localeCompare(b.feed_url);

/** Every creator with priority or attention, most important first. The
 *  auto-enqueue walks this list from the top until a creator has something
 *  unchecked. */
export async function rankCreators(): Promise<RankedCreator[]> {
  const [projects, scores] = await Promise.all([fetchCreatorProjects(), fetchCreatorVisitScores(LAST_POSTS_PER_CREATOR)]);

  // The database already groups creators case-insensitively, so there is one
  // row per creator here. The key is normalized again because the same creator
  // has to be found from a project row too, and a project stores whatever
  // casing it was created with.
  const scoreByUrl = new Map(scores.map(({ feed_url, ...score }) => [normalizeFeedUrl(feed_url), { feed_url, score }]));

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
    const visited = scoreByUrl.get(normalizeFeedUrl(p.feed_url));
    ranked.push({
      project_slug: p.project_slug,
      feed_type: feed.feed_type,
      feed_url: p.feed_url,
      priority: QUEUE_PRIORITY.prioritized,
      prioritized: true,
      priorityUntil: p.priority_until,
      score: visited?.score ?? NO_VISITS,
      top_posts_refreshed_at: p.top_posts_refreshed_at,
      top_posts_attempted_at: p.top_posts_attempted_at,
    });
  }
  const alreadyRanked = new Set(ranked.map((c) => normalizeFeedUrl(c.feed_url)));

  for (const [key, visited] of scoreByUrl) {
    if (alreadyRanked.has(key) || visited.score.posts < MIN_VISITED_POSTS_TO_WALK) continue;
    // A captured feed URL of an unknown shape, or a corrupted old row, is
    // skipped rather than walked blindly. The pipeline has no other way to tell
    // what kind of feed it is, since the type is derived from the URL.
    const feed = canonicalFeed(visited.feed_url);
    if (!feed) {
      console.warn(`  skipping a visited creator: feed url is not a shape we can walk (${visited.feed_url})`);
      continue;
    }
    const known = knownByUrl.get(key);
    ranked.push({
      project_slug: known?.project_slug ?? feed.project_slug,
      feed_type: feed.feed_type,
      feed_url: known?.feed_url ?? feed.feed_url,
      priority: QUEUE_PRIORITY.backlog,
      prioritized: false,
      priorityUntil: null,
      score: visited.score,
      // A creator with no project yet has no refresh stamp, so their top posts
      // are computed the first time they are walked.
      top_posts_refreshed_at: known?.top_posts_refreshed_at ?? null,
      top_posts_attempted_at: known?.top_posts_attempted_at ?? null,
    });
  }

  ranked.sort(byPriorityThenScore);
  return ranked;
}
