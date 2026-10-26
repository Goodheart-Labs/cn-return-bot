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
 * This works while Common Notes is the only paced use of the plan. If we add
 * a second one, for example an X note writer that also runs on Claude Code,
 * do not let both pace themselves against the whole target. Instead, give
 * each use a fixed share of the weekly target, for example 60% of the week to
 * Common Notes and 20% to the X note writer. Each use then paces itself
 * against its own share. For that, each use has to measure its own usage
 * rather than the rise of the whole plan. The usage endpoint only reports the
 * total, so each use would need its own estimate, for example the cost that
 * Claude Code reports at the end of each of its runs. (Jim, 2026-10-26.)
 *
 * When the week is already at the target, or the runner has stopped reporting,
 * Claude gets no new post, and the pipeline checks new posts instead. Jim chose
 * that on 2026-10-26. */

import { duration } from "./logFormat";

/** The share of the weekly limit the posts should use up by the reset. Jim
 *  picked it on 2026-10-26. Nathan's own pacer on the box aims at 98%, so his
 *  tasks still get the rest. */
export const WEEKLY_USAGE_TARGET_PERCENT = 80;

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

/** The runner reads the usage every 5 minutes. A newest reading older than
 *  this means the runner is down, so Claude would not start a post. */
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

/** Who gets the next feed post, and for Claude, when it is due. */
export type ClaudePacing =
  | {
      writer: "claude";
      weekly: number;
      resetsAt: Date;
      usagePerPost: number;
      /** True when the default stood in for a missing measurement. */
      usagePerPostIsDefault: boolean;
      intervalMs: number;
      dueAt: Date;
    }
  | { writer: "pipeline"; reason: string };

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
    return { writer: "pipeline", reason: "The runner on ai-box has not reported the usage of Nathan's plan in the last 30 minutes" };
  }
  if (latest.weekly >= WEEKLY_USAGE_TARGET_PERCENT) {
    return {
      writer: "pipeline",
      reason: `Nathan's plan is at ${latest.weekly}% of its weekly limit, the target is ${WEEKLY_USAGE_TARGET_PERCENT}%, and the week resets at ${utcTime(latest.weeklyResetsAt)}`,
    };
  }
  const rise = usageRise(snapshot.readings);
  const measured = snapshot.postsTaken >= MIN_POSTS_FOR_USAGE_ESTIMATE && rise > 0;
  const usagePerPost = measured ? rise / snapshot.postsTaken : DEFAULT_USAGE_PER_POST_PERCENT;
  const msToReset = Math.max(0, latest.weeklyResetsAt.getTime() - now.getTime());
  const intervalMs = (msToReset * usagePerPost) / (WEEKLY_USAGE_TARGET_PERCENT - latest.weekly);
  return {
    writer: "claude",
    weekly: latest.weekly,
    resetsAt: latest.weeklyResetsAt,
    usagePerPost,
    usagePerPostIsDefault: !measured,
    intervalMs,
    dueAt: snapshot.lastTakenAt ? new Date(snapshot.lastTakenAt.getTime() + intervalMs) : now,
  };
}

/** The block the run log prints, so the spacing of Claude's posts is always
 *  explainable from the log alone. */
export function describeClaudePacing(pacing: ClaudePacing, snapshot: UsageSnapshot): string {
  if (pacing.writer === "pipeline") return `CLAUDE · ${pacing.reason} · the pipeline takes new feed posts`;
  const sample = pacing.usagePerPostIsDefault
    ? `default, fewer than ${MIN_POSTS_FOR_USAGE_ESTIMATE} posts in the last ${USAGE_WINDOW_HOURS}h`
    : `a ${usageRise(snapshot.readings)}% rise over ${snapshot.postsTaken} posts in the last ${USAGE_WINDOW_HOURS}h`;
  const lastTaken = snapshot.lastTakenAt ? utcTime(snapshot.lastTakenAt) : "never";
  return [
    `CLAUDE · Nathan's plan at ${pacing.weekly}% of its weekly limit, aiming at ${WEEKLY_USAGE_TARGET_PERCENT}% by the reset at ${utcTime(pacing.resetsAt)}`,
    `         ${pacing.usagePerPost.toFixed(3)}% per post (${sample})`,
    `         one post every ${duration(pacing.intervalMs)} · last taken ${lastTaken}`,
  ].join("\n");
}
