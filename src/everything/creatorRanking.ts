/**
 * Ranks the creators the auto-enqueue walks, so the daily budget follows
 * reader attention (GOO-60). The signal is the anonymous visit rows the
 * extension records: each one carries the creator's feed URL, captured on the
 * device at visit time.
 *
 * The order is: creators with an unexpired manual priority flag first, then
 * everyone else by how many visits their posts got inside the ranking window,
 * then the stored feed order as the tiebreak. A creator nobody visited and
 * nobody follows is not walked at all, so attention that fades takes its
 * spend with it.
 *
 * Creators that are visited but not followed only join the walk when
 * EVERYTHING_VISIT_CREATORS is set to "on". Without the switch this module
 * only reorders the feeds we already poll, which spends nothing new.
 */

import { fetchFollowedFeeds, fetchVisitCounts, QUEUE_PRIORITY } from "./db";
import { canonicalFeed } from "./feedUrls";

export const VISIT_RANKING_WINDOW_DAYS = 14;

/** A creator nobody follows needs this many visits inside the window before
 *  their new posts are walked, so one stray click does not buy a check.
 *  Followed and curated feeds are walked regardless, because following them
 *  was a deliberate act. */
export const MIN_VISITS_FOR_UNFOLLOWED_CREATOR = 2;

export interface RankedCreator {
  project_slug: string;
  feed_type: "substack" | "youtube";
  feed_url: string;
  /** The QUEUE_PRIORITY tier this creator's items enqueue at. */
  priority: number;
  flagged: boolean;
  visits: number;
}

const normalizeFeedUrl = (url: string) => url.replace(/\/+$/, "").toLowerCase();

export function visitedCreatorsEnabled(): boolean {
  return process.env.EVERYTHING_VISIT_CREATORS === "on";
}

function isFlagged(priorityUntil: string | null): boolean {
  return priorityUntil != null && Date.parse(priorityUntil) > Date.now();
}

/** Every creator the auto-enqueue should walk, most important first. */
export async function rankCreators(): Promise<RankedCreator[]> {
  const since = new Date(Date.now() - VISIT_RANKING_WINDOW_DAYS * 24 * 3600_000);
  const [feeds, counts] = await Promise.all([fetchFollowedFeeds(), fetchVisitCounts(since)]);

  // Counts are aggregated under the normalized URL, because the database
  // groups by the URL as captured and two casings of the same feed must not
  // split or shadow each other. The first-seen original casing is kept for
  // walking, since a /channel/UC… id is case-sensitive.
  const visitsByUrl = new Map<string, { feed_url: string; visits: number }>();
  for (const c of counts) {
    const key = normalizeFeedUrl(c.feed_url);
    const entry = visitsByUrl.get(key);
    if (entry) entry.visits += c.visits;
    else visitsByUrl.set(key, { feed_url: c.feed_url.replace(/\/+$/, ""), visits: c.visits });
  }
  const followedUrls = new Set(feeds.map((f) => normalizeFeedUrl(f.feed_url)));

  // storedIndex is the tiebreak among equal visit counts: followed feeds keep
  // their stored order, and a visited-only creator sorts after every stored
  // feed it ties with.
  const ranked: (RankedCreator & { storedIndex: number })[] = feeds.map((feed, storedIndex) => ({
    project_slug: feed.project_slug,
    feed_type: feed.feed_type,
    feed_url: feed.feed_url,
    priority: feed.priority,
    flagged: isFlagged(feed.priority_until),
    visits: visitsByUrl.get(normalizeFeedUrl(feed.feed_url))?.visits ?? 0,
    storedIndex,
  }));

  if (visitedCreatorsEnabled()) {
    for (const [key, { feed_url, visits }] of visitsByUrl) {
      if (followedUrls.has(key)) continue;
      if (visits < MIN_VISITS_FOR_UNFOLLOWED_CREATOR) continue;
      // A captured feed URL of an unknown shape (or a corrupted old row) is
      // skipped rather than walked blindly.
      const feed = canonicalFeed(feed_url);
      if (!feed) continue;
      ranked.push({ ...feed, priority: QUEUE_PRIORITY.followed, flagged: false, visits, storedIndex: Infinity });
    }
  }

  ranked.sort(
    (a, b) =>
      Number(b.flagged) - Number(a.flagged) || b.visits - a.visits || a.storedIndex - b.storedIndex,
  );
  return ranked.map(({ storedIndex, ...creator }) => creator);
}
