/* Spaces the Claude note writer's feed posts so that the weekly usage of
 * Nathan's Claude plan reaches its target by the weekly reset (GOO-587).
 *
 * The Claude note writer runs on Nathan's ai-box and is paid for by his Claude
 * subscription, not by OpenRouter money. Anthropic's usage endpoint says how
 * much of the plan's weekly limit is used, as a whole percent, and when the
 * week resets. The runner on ai-box (src/claude-notes/runner.ts) reads it every
 * 5 minutes and stores each reading in everything_claude_usage.
 *
 * The rule mirrors the money pacing in pacing.ts, with usage in place of
 * dollars and the weekly reset in place of midnight:
 *
 *   interval between posts = time until the reset × usage per post
 *                            ÷ (target − usage now)
 *
 * The usage per post is the rise of the weekly usage over the last 7 days,
 * divided by the posts Claude took in that time. That rise includes every
 * other use of the plan, such as Nathan's own tasks on the box. So a post
 * looks more expensive while other work runs, and the posts slow down by just
 * enough for the total to land on the target. The formula is computed again on
 * every run, so an estimate that was off corrects itself as the reset comes
 * closer.
 *
 * Since GOO-527 the plan has a second user: the X note writer, which also
 * runs Claude Code on the ai-box. Only Common Notes paces itself against the
 * 80% target. The X note writer is capped instead, at a fixed share of the
 * week that it measures from the cost Claude Code reports for each Claude run
 * on the ai-box (src/claude-notes/xShare.ts and usageShare.ts). Its usage is part of the plan's rise, so
 * a Common Notes post looks more expensive while X runs, and Common Notes gets
 * whatever of the 80% the X note writer leaves. Jim gave X 20% and Common Notes
 * 60% on 2026-10-27.
 *
 * The interval is stretched by 10%, so the week most likely ends a little
 * under the target rather than over it. Once the week is at the target, the
 * walk adds no new post until the reset. Claude still takes everything that is
 * already in the queue, reader requests included, until the runner's own stop
 * at 90% (MAX_WEEKLY_USAGE_PERCENT). Above that, queued items wait for the
 * reset. When the runner has not reported for 30 minutes, it is taken to be
 * down, and the feed run goes red. Nothing goes to the pipeline in either
 * case. Jim set these rules on 2026-10-26, and removed
 * the pipeline as the fallback on 2026-10-28 (GOO-618). */

import { duration } from "./logFormat";

/** The share of the weekly limit the posts should use up by the reset. Jim
 *  picked it on 2026-10-26. Nathan's own pacer on the box aims at 98%, so his
 *  tasks still get the rest. */
export const WEEKLY_USAGE_TARGET_PERCENT = 80;

/** The interval is stretched by this factor, so that an estimate a little too
 *  low does not carry the week past the target. */
export const INTERVAL_SAFETY_FACTOR = 1.1;

/** How far back the usage per post is measured. A whole week evens out the
 *  days when other work on the plan ran, or when the posts were unusually long
 *  or short. Jim chose 7 days over 48 hours on 2026-10-26. */
export const USAGE_WINDOW_HOURS = 7 * 24;

/** The window never reaches back before the runner started on ai-box. Before
 *  then the note writer ran on the devbox, partly on Jim's plan, so its 618
 *  posts barely show in the readings of Nathan's plan. Counting them made a
 *  post look three times cheaper than it is. From 2026-10-31 the 7 days lie
 *  wholly after this, and the date no longer matters. */
export const USAGE_WINDOW_NOT_BEFORE = new Date("2026-10-24T05:27:00Z");

/** Below this many posts in the window the measured usage per post says
 *  little, and DEFAULT_USAGE_PER_POST_PERCENT stands in. */
export const MIN_POSTS_FOR_USAGE_ESTIMATE = 5;

/** What one post cost from Sunday's reset to Monday morning, 2026-10-26: the
 *  weekly usage rose from 0% to 3% over 29 posts. */
export const DEFAULT_USAGE_PER_POST_PERCENT = 0.1;

/** Above this share of Nathan's weekly limit the runner on ai-box starts no
 *  new Claude. The feed run already stops giving Claude feed posts at the
 *  target, so this stop holds back mainly reader requests, which Claude takes
 *  without pacing, and X tweets. Everything queued then waits for the weekly
 *  reset. */
export const MAX_WEEKLY_USAGE_PERCENT = 90;

/** The runner reads the usage every 5 minutes. A newest reading older than
 *  this means the runner on ai-box is down, so Claude would not start a post. */
export const MAX_USAGE_READING_AGE_MS = 30 * 60_000;

export interface UsageReading {
  at: Date;
  /** Percent of the weekly limit used. */
  weekly: number;
  /** Null in readings copied from logs that did not keep it. */
  weeklyResetsAt: Date | null;
}

/** Everything the rule needs, read in one go. */
export interface UsageSnapshot {
  now: Date;
  /** The readings of the last USAGE_WINDOW_HOURS, oldest first. */
  readings: UsageReading[];
  /** How many posts Claude took in the same hours. Reader requests count,
   *  because they use the plan too. */
  postsTaken: number;
  /** When Claude last took a post, a reader request included. */
  lastTakenAt: Date | null;
}

/** When Claude's next feed post is due, or that the runner on ai-box is down.
 *  At the target the interval is infinite and the next post is due at the
 *  reset. */
export type ClaudePacing =
  | {
      kind: "paced";
      weekly: number;
      resetsAt: Date;
      usagePerPost: number;
      /** True when the default stood in for a missing measurement. */
      usagePerPostIsDefault: boolean;
      intervalMs: number;
      dueAt: Date;
    }
  | { kind: "runner_silent"; reason: string };

/** How much the weekly usage rose over the readings. The drop at a weekly
 *  reset is not a negative rise, so only increases count. */
export function usageRise(readings: UsageReading[]): number {
  let rise = 0;
  for (let i = 1; i < readings.length; i++) rise += Math.max(0, readings[i]!.weekly - readings[i - 1]!.weekly);
  return rise;
}

const utcTime = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function computeClaudePacing(snapshot: UsageSnapshot): ClaudePacing {
  const { now } = snapshot;
  const latest = snapshot.readings.at(-1);
  if (!latest?.weeklyResetsAt || now.getTime() - latest.at.getTime() > MAX_USAGE_READING_AGE_MS) {
    return { kind: "runner_silent", reason: "The runner on ai-box has not reported the usage of Nathan's plan in the last 30 minutes" };
  }
  const rise = usageRise(snapshot.readings);
  const measured = snapshot.postsTaken >= MIN_POSTS_FOR_USAGE_ESTIMATE && rise > 0;
  const usagePerPost = measured ? rise / snapshot.postsTaken : DEFAULT_USAGE_PER_POST_PERCENT;
  const msToReset = Math.max(0, latest.weeklyResetsAt.getTime() - now.getTime());
  const usageLeft = WEEKLY_USAGE_TARGET_PERCENT - latest.weekly;
  const intervalMs = usageLeft > 0 ? (INTERVAL_SAFETY_FACTOR * msToReset * usagePerPost) / usageLeft : Infinity;
  return {
    kind: "paced",
    weekly: latest.weekly,
    resetsAt: latest.weeklyResetsAt,
    usagePerPost,
    usagePerPostIsDefault: !measured,
    intervalMs,
    dueAt: usageLeft <= 0 ? latest.weeklyResetsAt : snapshot.lastTakenAt ? new Date(snapshot.lastTakenAt.getTime() + intervalMs) : now,
  };
}

/** The block the run log prints, so the spacing of Claude's posts is always
 *  explainable from the log alone. */
export function describeClaudePacing(pacing: ClaudePacing, snapshot: UsageSnapshot): string {
  if (pacing.kind === "runner_silent") return `CLAUDE · ${pacing.reason} · nothing takes the queued posts`;
  const sample = pacing.usagePerPostIsDefault
    ? `default, fewer than ${MIN_POSTS_FOR_USAGE_ESTIMATE} posts in the last ${USAGE_WINDOW_HOURS}h`
    : `a ${usageRise(snapshot.readings)}% rise over ${snapshot.postsTaken} posts in the last ${USAGE_WINDOW_HOURS}h`;
  const lastTaken = snapshot.lastTakenAt ? utcTime(snapshot.lastTakenAt) : "never";
  return [
    `CLAUDE · Nathan's plan at ${pacing.weekly}% of its weekly limit, aiming at ${WEEKLY_USAGE_TARGET_PERCENT}% by the reset at ${utcTime(pacing.resetsAt)}`,
    `         ${pacing.usagePerPost.toFixed(3)}% per post (${sample})`,
    pacing.intervalMs === Infinity
      ? `         the target is reached · no new feed post until the reset · last taken ${lastTaken}`
      : `         one post every ${duration(pacing.intervalMs)}, ${INTERVAL_SAFETY_FACTOR}× the even spacing · last taken ${lastTaken}`,
  ].join("\n");
}
