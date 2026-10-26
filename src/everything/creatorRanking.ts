/**
 * Ranks the creators the auto-enqueue walks, so the daily budget follows
 * reader attention (GOO-60, reworked by GOO-107, GOO-135 and GOO-257).
 *
 * There are exactly two reasons to walk a creator:
 *
 *   1. They hold priority. Someone pressed the button in the extension, or ran
 *      everything-prioritize. That lasts seven days and then lapses.
 *   2. Someone visited one of their posts with the extension (see THE SCORE
 *      below).
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
 * Since 2026-10-23 the score also counts imagined posts: 2 that nobody read
 * and 3 with the average number of readers per post over all visited creators,
 * computed on every run (creatorScore in everything-core/readers.ts, GOO-549). Before, a creator with two or three
 * visited posts could top the walk on one shared link. On that day the plain
 * average ranked joec, with 5.67 readers per post over 3 posts, above Astral
 * Codex Ten, with 3.9 over 10. The imagined posts weigh little against 10 real
 * ones and a lot against 2.
 *
 * Every visited creator is walked, however low their score (GOO-587, Jim,
 * 2026-10-26). Until then a creator needed a score of at least 1 over at
 * least 2 visited posts. That left about 100 of the roughly 4,800 visited
 * creators, and on 2026-10-26 the walk already went down to rank 61 of them
 * to find one unchecked post. The Claude note writer can check far more posts
 * a week than that. The score still orders the walk, so a creator with one
 * reader per post is reached only when everyone above them is caught up. A
 * failed post waits with its creator in rank order (GOO-487), so it is not
 * pushed behind the low-ranked creators.
 */

import { fetchCreatorProjects, fetchCreatorVisitScores, QUEUE_PRIORITY, type CreatorVisitScore } from "./db";
import { canonicalFeed, type FeedType } from "./feedUrls";
import { normalizeFeedUrl } from "../everything-core/pageUrls";
import {
  averageReadersPerPost,
  byWalkOrder,
  creatorScore,
} from "../everything-core/readers";

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
  /** What the creator's score is made of. All zero for a prioritised creator
   *  nobody has visited. */
  score: Omit<CreatorVisitScore, "feed_url">;
  /** The score the walk ranks on (creatorScore). */
  walkScore: number;
  /** When this creator's top posts were last recomputed (GOO-81). */
  top_posts_refreshed_at: string | null;
  /** When a refresh was last tried and failed (migration 101). */
  top_posts_attempted_at: string | null;
}

const isOpen = (priorityUntil: string | null): boolean =>
  priorityUntil != null && Date.parse(priorityUntil) > Date.now();

const NO_VISITS: RankedCreator["score"] = { visitors_per_post: 0, posts: 0, people: 0 };

/** Every creator with priority or attention, most important first. The
 *  auto-enqueue walks this list from the top until a creator has something
 *  unchecked. */
export async function rankCreators(): Promise<RankedCreator[]> {
  const [projects, scores] = await Promise.all([fetchCreatorProjects(), fetchCreatorVisitScores()]);

  // The database already groups creators case-insensitively, so there is one
  // row per creator here. The key is normalized again because the same creator
  // has to be found from a project row too, and a project stores whatever
  // casing it was created with.
  const scoreByUrl = new Map(scores.map(({ feed_url, ...score }) => [normalizeFeedUrl(feed_url), { feed_url, score }]));
  const averageReaders = averageReadersPerPost(scores);

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
      walkScore: creatorScore(visited?.score ?? NO_VISITS, averageReaders),
      top_posts_refreshed_at: p.top_posts_refreshed_at,
      top_posts_attempted_at: p.top_posts_attempted_at,
    });
  }
  const alreadyRanked = new Set(ranked.map((c) => normalizeFeedUrl(c.feed_url)));

  for (const [key, visited] of scoreByUrl) {
    if (alreadyRanked.has(key)) continue;
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
      walkScore: creatorScore(visited.score, averageReaders),
      // A creator with no project yet has no refresh stamp, so their top posts
      // are computed the first time they are walked.
      top_posts_refreshed_at: known?.top_posts_refreshed_at ?? null,
      top_posts_attempted_at: known?.top_posts_attempted_at ?? null,
    });
  }

  ranked.sort(byWalkOrder);
  return ranked;
}
