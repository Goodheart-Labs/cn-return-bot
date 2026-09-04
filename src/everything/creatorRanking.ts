/**
 * Ranks the creators the auto-enqueue walks, so the daily budget follows
 * reader attention (GOO-60, reworked by GOO-107).
 *
 * There are exactly two reasons to walk a creator, and nothing is permanent:
 *
 *   1. They hold priority. Someone pressed the button in the extension, or ran
 *      everything-prioritize. That lasts seven days and then lapses.
 *   2. Readers visited them, at least MIN_VISITS_TO_WALK_CREATOR times inside
 *      the ranking window.
 *
 * Prioritised creators come first, then everyone by visit count. A creator in
 * neither set is not walked at all, so attention that fades takes its spend
 * with it.
 *
 * Both sides are needed because a creator nobody has ever checked has no row
 * anywhere. Prioritised creators are project rows; visited creators are
 * aggregated out of the anonymous visit rows the extension writes, and most of
 * them have no project yet. Creating a project for every creator anyone visits
 * would fill the public projects table with creators we have never checked, so
 * a project row is made at the moment a creator is pressed or their first item
 * is ingested, and not before.
 */

import { fetchCreatorProjects, fetchVisitCounts, QUEUE_PRIORITY } from "./db";
import { canonicalFeed } from "./feedUrls";

export const VISIT_RANKING_WINDOW_DAYS = 14;

/** How many visits inside the window a creator needs before we walk them on
 *  attention alone, so one stray click does not buy a check. A creator holding
 *  priority is walked whatever their visits, because someone asked for them. */
export const MIN_VISITS_TO_WALK_CREATOR = 2;

export interface RankedCreator {
  project_slug: string;
  feed_url: string;
  /** The QUEUE_PRIORITY tier this creator's items enqueue at. */
  priority: number;
  /** True while the creator's priority window is open. Such a creator ranks
   *  strictly above every creator walked on visits alone. */
  prioritized: boolean;
  /** When the priority window runs out, for the run log. Null when the creator
   *  is walked on visits alone. */
  priorityUntil: string | null;
  visits: number;
  /** When this creator's top posts were last recomputed (GOO-81). */
  top_posts_refreshed_at: string | null;
}

const normalizeFeedUrl = (url: string) => url.replace(/\/+$/, "").toLowerCase();

const isOpen = (priorityUntil: string | null): boolean =>
  priorityUntil != null && Date.parse(priorityUntil) > Date.now();

/** Every creator the auto-enqueue should walk, most important first. */
export async function rankCreators(): Promise<RankedCreator[]> {
  const since = new Date(Date.now() - VISIT_RANKING_WINDOW_DAYS * 24 * 3600_000);
  const [projects, counts] = await Promise.all([fetchCreatorProjects(), fetchVisitCounts(since)]);

  // Counts are aggregated under the normalized URL, because the database groups
  // by the URL as captured and two casings of the same feed must not split or
  // shadow each other. The first-seen original casing is kept for walking,
  // since a /channel/UC… id is case-sensitive.
  const visitsByUrl = new Map<string, { feed_url: string; visits: number }>();
  for (const c of counts) {
    const key = normalizeFeedUrl(c.feed_url);
    const entry = visitsByUrl.get(key);
    if (entry) entry.visits += c.visits;
    else visitsByUrl.set(key, { feed_url: c.feed_url.replace(/\/+$/, ""), visits: c.visits });
  }

  // Known creators are indexed by feed URL rather than by slug, because a slug
  // is not always what the URL derives to: thezvi.substack.com is project
  // `zvi`, @DwarkeshPatel is `dwarkesh` and astralcodexten is `acx`. Matching
  // on the URL is what keeps a creator walked on visits alone attached to the
  // project their notes already live in.
  const knownByUrl = new Map(projects.map((p) => [normalizeFeedUrl(p.feed_url), p]));

  const ranked: RankedCreator[] = projects.filter((p) => isOpen(p.priority_until)).map((p) => ({
    project_slug: p.project_slug,
    feed_url: p.feed_url,
    priority: QUEUE_PRIORITY.prioritized,
    prioritized: true,
    priorityUntil: p.priority_until,
    visits: visitsByUrl.get(normalizeFeedUrl(p.feed_url))?.visits ?? 0,
    top_posts_refreshed_at: p.top_posts_refreshed_at,
  }));
  const alreadyRanked = new Set(ranked.map((c) => normalizeFeedUrl(c.feed_url)));

  for (const [key, { feed_url, visits }] of visitsByUrl) {
    if (alreadyRanked.has(key)) continue;
    if (visits < MIN_VISITS_TO_WALK_CREATOR) continue;
    // A captured feed URL of an unknown shape, or a corrupted old row, is
    // skipped rather than walked blindly. The pipeline has no other way to tell
    // what kind of feed it is, since the type is derived from the URL.
    const feed = canonicalFeed(feed_url);
    if (!feed) continue;
    const known = knownByUrl.get(key);
    ranked.push({
      project_slug: known?.project_slug ?? feed.project_slug,
      feed_url: known?.feed_url ?? feed.feed_url,
      priority: QUEUE_PRIORITY.backlog,
      prioritized: false,
      priorityUntil: null,
      visits,
      // A creator with no project yet has no refresh stamp, so their top posts
      // are computed the first time they are walked.
      top_posts_refreshed_at: known?.top_posts_refreshed_at ?? null,
    });
  }

  // Priority first, then attention. Ties go to the creator whose feed URL sorts
  // first, so the order is stable from run to run rather than depending on how
  // the database happened to return the rows.
  ranked.sort(
    (a, b) =>
      Number(b.prioritized) - Number(a.prioritized) ||
      b.visits - a.visits ||
      a.feed_url.localeCompare(b.feed_url),
  );
  return ranked;
}
