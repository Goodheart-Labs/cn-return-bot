/* How often cn-walk reads each Substack feed (GOO-791). Substack has no list
 * of new posts across publications, so each walked publication's feed is read
 * on a schedule. All feeds share a fixed budget of reads a day, and a feed's
 * share grows with the square root of its creator score: 4 times the score
 * means twice the reads, 100 times the score 10 times the reads.
 *
 * The feeds are taken highest score first, with the creators holding
 * priority before everyone. Each gets the budget still left times its weight,
 * divided by the weights of the feeds still left. No feed is read more often
 * than every MIN_SECONDS_BETWEEN_FEED_READS, and a creator holding priority is
 * read exactly that often. What a feed at that floor does not use goes to the
 * feeds after it. More creators do not mean more reads: the same budget is
 * shared more thinly. */

/** Substack reads a day, for all walked publications together. At this
 *  budget a read goes out about every 1.7 seconds, and most are answered with
 *  304 Not Modified and no body. */
export const FEED_READS_PER_DAY = 50_000;

/** No feed is read more often than this. */
export const MIN_SECONDS_BETWEEN_FEED_READS = 20;

const DAY_MS = 24 * 3600_000;
const MAX_READS_PER_FEED = DAY_MS / (MIN_SECONDS_BETWEEN_FEED_READS * 1000);

export type ScheduledFeed = { feedUrl: string; score: number; prioritized: boolean };

/** Each feed's waiting time between two reads, in milliseconds. */
export function feedWaits(feeds: ScheduledFeed[], readsPerDay = FEED_READS_PER_DAY): Map<string, number> {
  const ordered = [...feeds].sort((a, b) => Number(b.prioritized) - Number(a.prioritized) || b.score - a.score || a.feedUrl.localeCompare(b.feedUrl));
  const weight = (feed: ScheduledFeed) => Math.sqrt(Math.max(feed.score, 0));
  let budgetLeft = readsPerDay;
  let weightsLeft = ordered.reduce((sum, feed) => sum + weight(feed), 0);
  const waits = new Map<string, number>();
  for (const feed of ordered) {
    const share = weightsLeft > 0 ? (budgetLeft * weight(feed)) / weightsLeft : 0;
    const reads = feed.prioritized ? MAX_READS_PER_FEED : Math.min(share, MAX_READS_PER_FEED);
    budgetLeft = Math.max(0, budgetLeft - reads);
    weightsLeft -= weight(feed);
    waits.set(feed.feedUrl, reads > 0 ? DAY_MS / reads : DAY_MS);
  }
  return waits;
}

/** When a feed is read next: the time its last read was due plus its waiting
 *  time. A feed that fell more than one waiting time behind, for example after
 *  the box was down, starts again from now, so feeds do not pile up. */
export function nextDue(lastDue: number, wait: number, now: number): number {
  const next = lastDue + wait;
  return next < now - wait ? now : next;
}
