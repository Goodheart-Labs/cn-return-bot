/**
 * When the next feed run should start, so the day's budget is spread across
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
 * (migration 099). Every run computes this at its end and stores the result
 * as an alarm, and the database starts
 * the next run when the alarm has come (everything_feed_schedule, migration
 * 097). A cheap post shortens the next interval a little and an expensive
 * post lengthens it.
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
 * it, so a big reader page pushes the next feed run out.
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

/** How long a run that found nothing to process sets the alarm for. Without
 *  it an idle pipeline would be started every minute, since the interval is
 *  measured from a post start that never moves. Thirty minutes is the cadence
 *  the fixed timer had. The other timing rule, the database's 45-minute
 *  backstop for a run that never set its alarm, lives in migration 098. */
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
  /** True when a thin sample's mean was raised to the default. */
  meanIsFloored: boolean;
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

export type AlarmReason = "interval" | "midnight" | "idle";

/** When the database should start the next run, and why that time. */
export interface FeedAlarm {
  at: Date;
  reason: AlarmReason;
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + DAY_MS);
}

/** The mean the rule uses. A null mean means no data. A zero mean means the
 *  cost rows of every sampled post are missing, which can happen because
 *  they are written best-effort. Both take the default. A sample of fewer
 *  than MEAN_COST_RULE.minPosts posts is held to at least the default: on
 *  2026-09-15 one post that found no claims and cost 0.0002 USD was the whole
 *  sample, the rule concluded it could afford 238,600 posts a day, admitted
 *  every creator, and the walk ran for hours. The floor only raises a thin
 *  mean, never lowers one, and stops applying once the sample is full. */
function usableMean(snapshot: FeedPacingSnapshot): { mean: number; isDefault: boolean; isFloored: boolean } {
  const mean = snapshot.meanPostCostUsd;
  if (mean === null || mean <= 0) return { mean: DEFAULT_MEAN_POST_COST_USD, isDefault: true, isFloored: false };
  if (snapshot.samplePosts < MEAN_COST_RULE.minPosts && mean < DEFAULT_MEAN_POST_COST_USD) {
    return { mean: DEFAULT_MEAN_POST_COST_USD, isDefault: false, isFloored: true };
  }
  return { mean, isDefault: false, isFloored: false };
}

export function computeNextRun(snapshot: FeedPacingSnapshot, feedBudgetUsd: number): NextRun {
  const { mean, isDefault, isFloored } = usableMean(snapshot);
  const moneyLeftUsd = feedBudgetUsd - snapshot.spentTodayUsd;
  const midnight = nextUtcMidnight(snapshot.dbNow);
  const hoursLeft = (midnight.getTime() - snapshot.dbNow.getTime()) / HOUR_MS;
  if (moneyLeftUsd < mean) {
    return { meanPostCostUsd: mean, meanIsDefault: isDefault, meanIsFloored: isFloored, moneyLeftUsd, hoursLeft, intervalMs: Infinity, dueAt: midnight, closedForToday: true };
  }
  const intervalMs = (hoursLeft * HOUR_MS * mean) / moneyLeftUsd;
  // Only "never started" makes a run due at once. A post that started at
  // 23:59 yesterday still holds the next one to its interval, so midnight
  // does not cause two starts in a row.
  const dueAt = snapshot.lastFeedStartedAt
    ? new Date(snapshot.lastFeedStartedAt.getTime() + intervalMs)
    : snapshot.dbNow;
  return { meanPostCostUsd: mean, meanIsDefault: isDefault, meanIsFloored: isFloored, moneyLeftUsd, hoursLeft, intervalMs, dueAt, closedForToday: false };
}

/** The alarm a run sets at its end. `started` says whether this run started a
 *  feed item; a run that found nothing to do asks again after the idle wait,
 *  because the interval alone would make it due at once and forever. */
export function nextAlarm(nextRun: NextRun, snapshot: FeedPacingSnapshot, started: boolean): FeedAlarm {
  if (nextRun.closedForToday) return { at: nextRun.dueAt, reason: "midnight" };
  if (!started) return { at: new Date(snapshot.dbNow.getTime() + IDLE_RECHECK_MS), reason: "idle" };
  return { at: nextRun.dueAt, reason: "interval" };
}

/** How many posts a day the feed budget buys at the current mean. The creator
 *  admission in the walk fills the day with this many posts. */
export const affordablePostsPerDay = (meanPostCostUsd: number, feedBudgetUsd: number): number =>
  feedBudgetUsd / meanPostCostUsd;

const utcClock = (d: Date) => d.toISOString().slice(11, 16) + " UTC";

/** The one block the run log prints, so a strange interval is always
 *  explainable from the log alone. */
export function describePacing(nextRun: NextRun, snapshot: FeedPacingSnapshot, feedBudgetUsd: number): string {
  const posts = `${snapshot.samplePosts} post${snapshot.samplePosts === 1 ? "" : "s"} in the last ${snapshot.sampleHours}h`;
  const sample = nextRun.meanIsDefault
    ? `default, no feed post finished in the last ${snapshot.sampleHours}h`
    : nextRun.meanIsFloored
      ? `held at the ${money(DEFAULT_MEAN_POST_COST_USD)} default: only ${posts}, ${money(snapshot.meanPostCostUsd ?? 0)} on average, ${MEAN_COST_RULE.minPosts} needed`
      : `over ${posts}`;
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

const ALARM_REASONS: Record<AlarmReason, string> = {
  interval: "one interval after the last post started",
  midnight: "the budget resets at midnight",
  idle: "nothing to process, looking again after the idle wait",
};

/** The one line that says when the database will start the next run. */
export function describeAlarm(alarm: FeedAlarm, snapshot: FeedPacingSnapshot): string {
  const inMs = alarm.at.getTime() - snapshot.dbNow.getTime();
  const when = inMs <= 0 ? "at once, the pipeline is behind its schedule" : `at ${utcClock(alarm.at)}, in ${duration(inMs)}`;
  return `ALARM  · next run ${when} · ${ALARM_REASONS[alarm.reason]}`;
}
