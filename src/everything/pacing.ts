/**
 * When the next feed post should start, so the day's budget is spread across
 * the UTC day instead of spent in a burst after midnight.
 *
 * The rule is the one Jim asked for. Take the average cost of a post over the
 * last 48 hours, the money left in today's feed budget, and the hours left in
 * the day. A post checked before the pipeline's latest cost step never enters
 * the average, because it would overstate what a post costs now. The
 * interval between posts is hours left times the average cost divided by the
 * money left: that spacing makes the money last until midnight. The next run
 * is due that interval after the last feed post started. An attempt that
 * ended in error, a fetch that failed for instance, spent nothing and does
 * not count as that post: the next post is due as if it had never run
 * (migration 099). The feed worker on the services machine
 * (src/service/feed/main.ts) asks this rule before every start and sleeps
 * until the next post is due. A cheap post shortens the next interval a
 * little and an expensive post lengthens it. A post that outlasts its
 * interval does not hold the next one back: the worker starts it beside the
 * running one, up to its limit of posts in flight.
 *
 * Every input arrives in one database snapshot (everything_feed_pacing,
 * migration 096), and the alarm is computed in database time. The runner's
 * clock is never compared with the database's, which is the same rule the X
 * pipeline's submission lock follows. This module has no database access of
 * its own, and the feed budget is passed in, so it is testable without mocks.
 *
 * Reader-requested pages are outside this entirely. The intake service on the
 * machine processes them at once and spends from the full cap. Their spend
 * still counts in "spent today", exactly as the hard feed stop already counts
 * it, so a big reader page pushes the next feed post out.
 */

import { duration, money } from "./logFormat";

/** How the mean post cost is sampled. */
export interface MeanCostRule {
  /** The window the mean is taken over. */
  windowHours: number;
  /** Fewer finished posts than this in the window, and the mean is taken over
   *  the fallback window instead, so one or two posts cannot set the day's pace. */
  minPosts: number;
  fallbackHours: number;
  /** A post finished before this moment never enters the mean, whichever
   *  window is used. The pipeline gets cheaper in steps, and a post checked
   *  before the latest step would overstate what a post costs now. Move it
   *  forward whenever the cost of a post changes again. */
  notBefore: Date;
}

export const MEAN_COST_RULE: MeanCostRule = {
  windowHours: 48,
  minPosts: 5,
  fallbackHours: 7 * 24,
  // When PR 463, the cheap pipeline (GOO-159), reached main.
  notBefore: new Date("2026-09-15T13:24:00Z"),
};

/** Used when no feed post has finished since the latest cost step. Jim's
 *  guess for a post on the cheap pipeline (2026-09-15). */
export const DEFAULT_MEAN_POST_COST_USD = 1;

/** How long the feed worker waits before looking again after it found nothing
 *  to process. Without it an idle worker would walk every creator's feed in a
 *  tight loop, since the interval is measured from a post start that never
 *  moves. Thirty minutes is the cadence the old fixed timer had. */
export const IDLE_RECHECK_MS = 30 * 60_000;

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** What everything_feed_pacing returns, in one snapshot. */
export interface FeedPacingSnapshot {
  dbNow: Date;
  spentTodayUsd: number;
  /** Null when no feed post finished in either window. */
  meanPostCostUsd: number | null;
  samplePosts: number;
  sampleHours: number;
  /** Null until any feed-tier item has ever entered processing. */
  lastFeedStartedAt: Date | null;
}

export interface NextRun {
  meanPostCostUsd: number;
  /** True when the default stood in for a missing mean. */
  meanIsDefault: boolean;
  moneyLeftUsd: number;
  hoursLeft: number;
  /** The spacing between feed posts that makes the money last until midnight. */
  intervalMs: number;
  /** When the next feed post is due, in database time. */
  dueAt: Date;
  /** True when the money left does not cover one average post. The next run
   *  is then due at midnight, when the budget resets. */
  closedForToday: boolean;
}

/** Whether the feed worker may start a post now, and if not, how long until
 *  it may and why. */
export type FeedStart =
  | { type: "due" }
  /** The next post is due one interval after the last one started. */
  | { type: "interval"; waitMs: number }
  /** The money left does not cover one average post; the budget resets at midnight. */
  | { type: "midnight"; waitMs: number };

export function nextUtcMidnight(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + DAY_MS);
}

/** The mean the rule uses. A null mean means no data. A zero mean means the
 *  cost rows of every sampled post are missing, which can happen because
 *  they are written best-effort; treating that as no data keeps a zero from
 *  making every run due at once. */
function usableMean(meanPostCostUsd: number | null): { mean: number; isDefault: boolean } {
  return meanPostCostUsd !== null && meanPostCostUsd > 0
    ? { mean: meanPostCostUsd, isDefault: false }
    : { mean: DEFAULT_MEAN_POST_COST_USD, isDefault: true };
}

export function computeNextRun(snapshot: FeedPacingSnapshot, feedBudgetUsd: number): NextRun {
  const { mean, isDefault } = usableMean(snapshot.meanPostCostUsd);
  const moneyLeftUsd = feedBudgetUsd - snapshot.spentTodayUsd;
  const midnight = nextUtcMidnight(snapshot.dbNow);
  const hoursLeft = (midnight.getTime() - snapshot.dbNow.getTime()) / HOUR_MS;
  if (moneyLeftUsd < mean) {
    return { meanPostCostUsd: mean, meanIsDefault: isDefault, moneyLeftUsd, hoursLeft, intervalMs: Infinity, dueAt: midnight, closedForToday: true };
  }
  const intervalMs = (hoursLeft * HOUR_MS * mean) / moneyLeftUsd;
  // Only "never started" makes a run due at once. A post that started at
  // 23:59 yesterday still holds the next one to its interval, so midnight
  // does not cause two starts in a row.
  const dueAt = snapshot.lastFeedStartedAt
    ? new Date(snapshot.lastFeedStartedAt.getTime() + intervalMs)
    : snapshot.dbNow;
  return { meanPostCostUsd: mean, meanIsDefault: isDefault, moneyLeftUsd, hoursLeft, intervalMs, dueAt, closedForToday: false };
}

/** The pacing rule's answer to "may a post start now". A due time in the
 *  past means the worker is behind its schedule and starts at once. */
export function nextFeedStart(nextRun: NextRun, snapshot: FeedPacingSnapshot): FeedStart {
  const waitMs = nextRun.dueAt.getTime() - snapshot.dbNow.getTime();
  if (nextRun.closedForToday) return { type: "midnight", waitMs };
  return waitMs > 0 ? { type: "interval", waitMs } : { type: "due" };
}

/** How many posts a day the feed budget buys at the current mean. The creator
 *  admission in the walk fills the day with this many posts. */
export const affordablePostsPerDay = (meanPostCostUsd: number, feedBudgetUsd: number): number =>
  feedBudgetUsd / meanPostCostUsd;

const utcClock = (d: Date) => d.toISOString().slice(11, 16) + " UTC";

/** The one block the run log prints, so a strange interval is always
 *  explainable from the log alone. */
export function describePacing(nextRun: NextRun, snapshot: FeedPacingSnapshot, feedBudgetUsd: number): string {
  const sample = nextRun.meanIsDefault
    ? `default, no feed post finished in the last ${snapshot.sampleHours}h`
    : `over ${snapshot.samplePosts} post${snapshot.samplePosts === 1 ? "" : "s"} in the last ${snapshot.sampleHours}h`;
  const lastStart = snapshot.lastFeedStartedAt ? utcClock(snapshot.lastFeedStartedAt) : "never";
  const lines = [
    `PACING · spent ${money(snapshot.spentTodayUsd)} today, ${money(nextRun.moneyLeftUsd)} of the ${money(feedBudgetUsd)} feed budget left, ${nextRun.hoursLeft.toFixed(1)}h left in the UTC day`,
    `         mean post cost ${money(nextRun.meanPostCostUsd)} (${sample}) · affords ${affordablePostsPerDay(nextRun.meanPostCostUsd, feedBudgetUsd).toFixed(1)} posts a day`,
  ];
  if (nextRun.closedForToday) {
    lines.push(`         the money left does not cover one average post · nothing more until midnight`);
  } else {
    lines.push(`         one post every ${duration(nextRun.intervalMs)} · last started ${lastStart}`);
  }
  return lines.join("\n");
}

/** The one line that says when the worker will start the next post. */
export function describeFeedStart(start: FeedStart): string {
  if (start.type === "due") return "START  · a post is due now";
  const why = start.type === "midnight" ? "the budget resets at midnight" : "one interval after the last post started";
  return `WAIT   · next post in ${duration(start.waitMs)} · ${why}`;
}
