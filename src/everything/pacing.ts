/**
 * When the next feed post may start, so the day's budget is spread across the
 * UTC day instead of spent in a burst after midnight.
 *
 * The rule is the one Jim asked for. Take the average cost of a recent post,
 * the money left in today's feed budget, and the hours left in the day. The
 * interval between posts is hours left times the average cost divided by the
 * money left: that spacing makes the money last until midnight. The next post
 * may start once that interval has passed since the last feed post started.
 * The interval is recomputed before every post, so a cheap post shortens the
 * next wait a little and an expensive post lengthens it.
 *
 * Every input arrives in one database snapshot (everything_feed_pacing,
 * migration 095), and "opens at" is computed in database time. The runner's
 * clock is never compared with the database's, which is the same rule the X
 * pipeline's submission lock follows. This module has no database access of
 * its own, and the feed budget is passed in, so it is testable without mocks.
 *
 * Reader-requested pages are outside this entirely. The intake service on the
 * machine processes them at once and spends from the full cap. Their spend
 * still counts in "spent today", exactly as the hard feed stop already counts
 * it, so a big reader page makes the feed gate go quiet for the day.
 */

import { duration, money } from "./logFormat";

/** The window the mean post cost is taken over. */
export const MEAN_COST_WINDOW_HOURS = 48;
/** Fewer finished posts than this in the window, and the mean is taken over
 *  the fallback window instead, so one or two posts cannot set the day's pace. */
export const MEAN_COST_MIN_POSTS = 5;
export const MEAN_COST_FALLBACK_HOURS = 7 * 24;
/** Used when no feed post finished in either window. About the mean of the
 *  week before pacing shipped. */
export const DEFAULT_MEAN_POST_COST_USD = 3.5;

/** The longest a run waits in place for the gate. Anything longer is left to
 *  a later dispatch, which fires every 30 minutes. */
export const MAX_IN_RUN_WAIT_MS = 25 * 60_000;
/** A run older than this never starts a wait. The job is killed at 120
 *  minutes, and a wait followed by a long post must stay clear of that. */
export const MAX_RUN_AGE_TO_WAIT_MS = 60 * 60_000;

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

export interface FeedGate {
  meanPostCostUsd: number;
  /** True when the default stood in for a missing mean. */
  meanIsDefault: boolean;
  moneyLeftUsd: number;
  hoursLeft: number;
  /** The spacing between feed posts that makes the money last until midnight. */
  intervalMs: number;
  /** When the next feed post may start, in database time. */
  opensAt: Date;
  /** True when the money left does not cover one average post. The gate then
   *  opens at midnight, when the budget resets. */
  closedForToday: boolean;
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + DAY_MS);
}

/** The mean the gate uses. A null mean means no data. A zero mean means the
 *  cost rows of every sampled post are missing, which can happen because
 *  they are written best-effort; treating that as no data keeps a zero from
 *  opening the gate permanently. */
function usableMean(meanPostCostUsd: number | null): { mean: number; isDefault: boolean } {
  return meanPostCostUsd !== null && meanPostCostUsd > 0
    ? { mean: meanPostCostUsd, isDefault: false }
    : { mean: DEFAULT_MEAN_POST_COST_USD, isDefault: true };
}

export function computeFeedGate(snapshot: FeedPacingSnapshot, feedBudgetUsd: number): FeedGate {
  const { mean, isDefault } = usableMean(snapshot.meanPostCostUsd);
  const moneyLeftUsd = feedBudgetUsd - snapshot.spentTodayUsd;
  const midnight = nextUtcMidnight(snapshot.dbNow);
  const hoursLeft = (midnight.getTime() - snapshot.dbNow.getTime()) / HOUR_MS;
  if (moneyLeftUsd < mean) {
    return { meanPostCostUsd: mean, meanIsDefault: isDefault, moneyLeftUsd, hoursLeft, intervalMs: Infinity, opensAt: midnight, closedForToday: true };
  }
  const intervalMs = (hoursLeft * HOUR_MS * mean) / moneyLeftUsd;
  // Only "never started" opens the gate outright. A post that started at
  // 23:59 yesterday still holds the next one to its interval, so midnight
  // does not cause two starts in a row.
  const opensAt = snapshot.lastFeedStartedAt
    ? new Date(snapshot.lastFeedStartedAt.getTime() + intervalMs)
    : snapshot.dbNow;
  return { meanPostCostUsd: mean, meanIsDefault: isDefault, moneyLeftUsd, hoursLeft, intervalMs, opensAt, closedForToday: false };
}

/** How long from the snapshot's clock until the gate opens. Zero or less
 *  means open now. */
export const waitMs = (gate: FeedGate, snapshot: FeedPacingSnapshot): number =>
  gate.opensAt.getTime() - snapshot.dbNow.getTime();

/** How many posts a day the feed budget buys at the current mean. The creator
 *  admission in the walk fills the day with this many posts. */
export const affordablePostsPerDay = (meanPostCostUsd: number, feedBudgetUsd: number): number =>
  feedBudgetUsd / meanPostCostUsd;

const utcClock = (d: Date) => d.toISOString().slice(11, 16) + " UTC";

/** The one block the run log prints per cycle, so a strange interval is
 *  always explainable from the log alone. */
export function describeGate(gate: FeedGate, snapshot: FeedPacingSnapshot, feedBudgetUsd: number): string {
  const sample = gate.meanIsDefault
    ? `default, no feed post finished in the last ${snapshot.sampleHours}h`
    : `over ${snapshot.samplePosts} post${snapshot.samplePosts === 1 ? "" : "s"} in the last ${snapshot.sampleHours}h`;
  const lastStart = snapshot.lastFeedStartedAt ? utcClock(snapshot.lastFeedStartedAt) : "never";
  const lines = [
    `PACING · spent ${money(snapshot.spentTodayUsd)} today, ${money(gate.moneyLeftUsd)} of the ${money(feedBudgetUsd)} feed budget left, ${gate.hoursLeft.toFixed(1)}h left in the UTC day`,
    `         mean post cost ${money(gate.meanPostCostUsd)} (${sample}) · affords ${affordablePostsPerDay(gate.meanPostCostUsd, feedBudgetUsd).toFixed(1)} posts a day`,
  ];
  if (gate.closedForToday) {
    lines.push(`         the money left does not cover one average post · closed until midnight`);
  } else {
    const wait = waitMs(gate, snapshot);
    lines.push(
      `         one post every ${duration(gate.intervalMs)} · last started ${lastStart} · ` +
        (wait <= 0 ? "open now" : `opens at ${utcClock(gate.opensAt)}, in ${duration(wait)}`),
    );
  }
  return lines.join("\n");
}
