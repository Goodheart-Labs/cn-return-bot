/* Spaces the Claude note writer's feed posts so that the weekly usage of its
 * Claude plan reaches its target by the weekly reset (GOO-587).
 *
 * The Claude note writer is paid for by a Claude
 * subscription, not by OpenRouter money. Since GOO-787 (2026-11-19) that is an
 * account of its own, which nothing else uses. Anthropic's usage endpoint says
 * how much of the plan's weekly limit is used, as a whole percent, and when
 * the week resets. Its runner (src/claude-notes/runner/main.ts)
 * reads it every 5 minutes and stores each reading in everything_claude_usage.
 * The runner turns the interval below into its pace, in whole minutes, and
 * reserves a feed post at most that often.
 *
 * The rule mirrors the money pacing in pacing.ts, with usage in place of
 * dollars and the weekly reset in place of midnight:
 *
 *   interval between posts = time until the reset × usage per post
 *                            ÷ (target − usage now − other usage until the reset)
 *
 * Every Claude the runner starts writes a row to everything_claude_runs with
 * what the run would have cost on the API. Because the account does nothing
 * else, those costs explain all of its usage (GOO-831). So the rise of the
 * weekly usage over the last 7 days, divided by the costs of the runs in the
 * same time, says how much of the week one API dollar uses. A post uses that
 * times the average cost of a post's run. The other runs (X tweets, note
 * judges, X handle lookups) use the plan too. Their usage per hour over the
 * window is expected to go on until the reset, and the posts get only what it
 * leaves of the target. Until GOO-831 the usage per post was the whole rise
 * divided by the posts reserved in the window. That counted posts the
 * notewriter took on another plan before its account changed, which made each
 * post look about a quarter cheaper than it was.
 *
 * The formula is computed again every 5 minutes, so an estimate that was off
 * corrects itself as the reset comes closer. The X note writer is capped on
 * its own, at a fixed share of the week (src/claude-notes/xShare.ts).
 *
 * The target history: Jim gave X 20% on 2026-10-27, raised the target from
 * 80% to 90% on 2026-11-05, and on 2026-11-10 lowered it to 60% and stopped
 * the Claude tweets, so that the week keeps room for his own work on the
 * weekend. On 2026-11-12 he raised it back to 90%, and on 2026-11-14 he raised
 * it to 98% and turned the Claude tweets back on. On 2026-11-15 he lowered it
 * to 70% again, and on 2026-11-16 raised it to 80%. On 2026-11-19 the note
 * writer moved to a Claude account of its own (GOO-787), and Jim set the
 * target to 90% and the stop to 95%.
 *
 * The interval is stretched by 10%, so the week most likely ends a little
 * under the target rather than over it. Once the week is at the target, the
 * runner takes no new feed post until the reset, and it still takes reader
 * requests until its own stop at 95% (MAX_WEEKLY_USAGE_PERCENT). Above that it
 * takes nothing, and queued items wait for the reset. Jim set these rules on
 * 2026-10-26. */

import { duration } from "./logFormat";

/** The share of the weekly limit the posts should use up by the reset. Jim
 *  picked 80% on 2026-10-26, raised it to 90% on 2026-11-05 and lowered it to
 *  60% on 2026-11-10, to keep usage for the weekend, raised it back to 90%
 *  on 2026-11-12, raised it to 98% on 2026-11-14, lowered it to 70% on
 *  2026-11-15, raised it to 80% on 2026-11-16, and to 90% on 2026-11-19, when
 *  the note writer got a Claude account that is used for nothing else. */
export const WEEKLY_USAGE_TARGET_PERCENT = 90;

/** The interval is stretched by this factor, so that an estimate a little too
 *  low does not carry the week past the target. */
export const INTERVAL_SAFETY_FACTOR = 1.1;

/** How far back the usage per dollar and the other runs' usage are measured.
 *  A whole week evens out the days when the posts were unusually long or
 *  short. Jim chose 7 days over 48 hours on 2026-10-26. */
export const USAGE_WINDOW_HOURS = 7 * 24;

/** Below this many post runs in the window the measurement says little, and
 *  DEFAULT_USAGE_PER_POST_PERCENT stands in. */
export const MIN_POSTS_FOR_USAGE_ESTIMATE = 5;

/** What one post cost from Sunday's reset to Monday morning, 2026-10-26: the
 *  weekly usage rose from 0% to 3% over 29 posts. */
export const DEFAULT_USAGE_PER_POST_PERCENT = 0.1;

/** Above this share of the notewriter's weekly limit the runner
 *  starts no new Claude. The feed run already stops giving Claude feed posts at the
 *  target, so this stop holds back mainly reader requests, which Claude takes
 *  without pacing, and X tweets. Everything queued then waits for the weekly
 *  reset. It sits 5 points above the target, so that reader requests and
 *  tweets still run for a while after the feed posts stop. Jim chose 95% on
 *  2026-11-19 (GOO-787); while the note writer shared his own plan it was 1
 *  point above the target. */
export const MAX_WEEKLY_USAGE_PERCENT = 95;

/** The runner reads the usage every 5 minutes. A newest reading older than
 *  this means the runner is down, so the X run hands it no tweet
 *  (src/claude-notes/xShare.ts). */
export const MAX_USAGE_READING_AGE_MS = 30 * 60_000;

export interface UsageReading {
  at: Date;
  /** Percent of the weekly limit used. */
  weekly: number;
  /** Null in readings copied from logs that did not keep it. */
  weeklyResetsAt: Date | null;
}

/** What the runs of the window would have cost on the API, split into the
 *  posts' runs and all other runs. Reader requests are posts too. */
export interface WindowCosts {
  postRuns: number;
  postCostUsd: number;
  otherCostUsd: number;
}

/** Everything the rule needs, read in one go. */
export interface UsageSnapshot {
  now: Date;
  /** The readings of the last USAGE_WINDOW_HOURS, oldest first. */
  readings: UsageReading[];
  /** The costs of the runs since the first of those readings. */
  costs: WindowCosts;
}

/** How far apart Claude's feed posts should be. At the target the interval is
 *  infinite: no new feed post until the reset. */
export type ClaudePacing = {
  weekly: number;
  resetsAt: Date;
  /** Percent of the weekly limit that one dollar of API cost uses. Null when
   *  the window is too thin to measure it. */
  usagePerDollar: number | null;
  usagePerPost: number;
  /** What the other runs are expected to use until the reset. */
  otherUsageUntilReset: number;
  intervalMs: number;
};

/** How much the weekly usage rose over the readings. The drop at a weekly
 *  reset is not a negative rise, so only increases count. */
export function usageRise(readings: UsageReading[]): number {
  let rise = 0;
  for (let i = 1; i < readings.length; i++) rise += Math.max(0, readings[i]!.weekly - readings[i - 1]!.weekly);
  return rise;
}

const utcTime = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

const HOUR_MS = 3600_000;

/** Null without a reading that says when the week resets. */
export function computeClaudePacing(snapshot: UsageSnapshot): ClaudePacing | null {
  const { now, readings, costs } = snapshot;
  const latest = readings.at(-1);
  if (!latest?.weeklyResetsAt) return null;
  const rise = usageRise(readings);
  const totalCostUsd = costs.postCostUsd + costs.otherCostUsd;
  const measured = costs.postRuns >= MIN_POSTS_FOR_USAGE_ESTIMATE && rise > 0 && totalCostUsd > 0;
  const usagePerDollar = measured ? rise / totalCostUsd : null;
  const usagePerPost = usagePerDollar === null ? DEFAULT_USAGE_PER_POST_PERCENT : (usagePerDollar * costs.postCostUsd) / costs.postRuns;
  const windowMs = now.getTime() - readings[0]!.at.getTime();
  const msToReset = Math.max(0, latest.weeklyResetsAt.getTime() - now.getTime());
  const otherUsageUntilReset = usagePerDollar === null || windowMs <= 0 ? 0 : (usagePerDollar * costs.otherCostUsd * msToReset) / windowMs;
  const usageLeftForPosts = WEEKLY_USAGE_TARGET_PERCENT - latest.weekly - otherUsageUntilReset;
  const intervalMs = usageLeftForPosts > 0 ? (INTERVAL_SAFETY_FACTOR * msToReset * usagePerPost) / usageLeftForPosts : Infinity;
  return { weekly: latest.weekly, resetsAt: latest.weeklyResetsAt, usagePerDollar, usagePerPost, otherUsageUntilReset, intervalMs };
}

const usd = (amount: number, digits = 0) => "$" + amount.toFixed(digits);

/** The lines that say how the usage per post was measured. */
function describeMeasurement(pacing: ClaudePacing, snapshot: UsageSnapshot): string[] {
  const { costs, readings } = snapshot;
  const windowHours = Math.round((snapshot.now.getTime() - readings[0]!.at.getTime()) / HOUR_MS);
  if (pacing.usagePerDollar === null) {
    return [`${pacing.usagePerPost.toFixed(3)}% per post (default, fewer than ${MIN_POSTS_FOR_USAGE_ESTIMATE} post runs or no rise in the last ${windowHours}h)`];
  }
  const totalCostUsd = costs.postCostUsd + costs.otherCostUsd;
  return [
    `${pacing.usagePerDollar.toFixed(4)}% per API dollar (a ${usageRise(readings)}% rise over ${usd(totalCostUsd)} of runs in the last ${windowHours}h)`,
    `${pacing.usagePerPost.toFixed(3)}% per post (${usd(costs.postCostUsd / costs.postRuns, 2)} on average over ${costs.postRuns} post runs)`,
    `the other runs cost ${usd(costs.otherCostUsd)} in that time, so they will use about ${pacing.otherUsageUntilReset.toFixed(1)}% until the reset`,
  ];
}

/** The block the runner's log prints, so the spacing of Claude's posts is
 *  always explainable from the log alone. */
export function describeClaudePacing(pacing: ClaudePacing, snapshot: UsageSnapshot): string {
  const indent = (line: string) => "         " + line;
  return [
    `CLAUDE · the plan at ${pacing.weekly}% of its weekly limit, aiming at ${WEEKLY_USAGE_TARGET_PERCENT}% by the reset at ${utcTime(pacing.resetsAt)}`,
    ...describeMeasurement(pacing, snapshot).map(indent),
    indent(
      pacing.intervalMs === Infinity
        ? "no usage left under the target for feed posts · no new feed post until the reset"
        : `one post every ${duration(pacing.intervalMs)}, ${INTERVAL_SAFETY_FACTOR}× the even spacing`,
    ),
  ].join("\n");
}
