/* The X note writer's share of Nathan's Claude plan (GOO-527, GOO-617).
 *
 * The Claude Code note writer on the ai-box writes Common Notes and, since
 * GOO-527, notes for some of the X bot's tweets. Both are paid for by Nathan's
 * Claude subscription. Jim gave X 20% of the week on 2026-10-27, and Common
 * Notes the rest of the 80% that usagePacing.ts aims at.
 *
 * How much of the week X used so far is its tag's share of the plan's usage
 * (src/claude-notes/usageShare.ts), split by the API-equivalent cost of every
 * Claude run on the ai-box. Nathan's own work on the plan has no cost row, so
 * it makes X's share look bigger. That only means X stops a little early.
 *
 * X may not use its whole share at the start of the week. Its allowance grows
 * evenly from 0% at the weekly reset to 20% at the next one. Without that, a
 * third of all tweets would use up the share in about a day and a half, and X
 * would get no Claude notes for the rest of the week.
 *
 * The X run reads this once at its start. While X is over its allowance, or
 * the runner on the ai-box would not start a Claude, a tweet that draws Claude
 * fails like a tweet whose model provider is out of credits (Jim,
 * 2026-10-28). It is not moved to the pipeline. Common Notes needs no change: its pacing aims the plan's total at 80%, and X's
 * usage is part of that total, so Common Notes gets whatever X leaves. */

import { MAX_USAGE_READING_AGE_MS, MAX_WEEKLY_USAGE_PERCENT } from "../everything/usagePacing";
import { CLAUDE_RUN_TAGS, readUsageSnapshot, usageShare, type UsageSnapshot } from "./usageShare";
export const X_SHARE_PERCENT = 20;
const WEEK_MS = 7 * 24 * 3600_000;

export type XShareSnapshot = UsageSnapshot & { now: Date };

export type XShare =
  | { kind: "measured"; usedPercent: number; allowedPercent: number }
  /** The runner on the ai-box would not start a Claude now. */
  | { kind: "runner_down"; reason: string };


export function computeXShare(snapshot: XShareSnapshot): XShare {
  const { latest, now } = snapshot;
  if (!latest || now.getTime() - latest.at.getTime() > MAX_USAGE_READING_AGE_MS) {
    return { kind: "runner_down", reason: "The runner on ai-box has not reported the usage of Nathan's plan in the last 30 minutes" };
  }
  if (latest.weekly >= MAX_WEEKLY_USAGE_PERCENT) {
    return { kind: "runner_down", reason: `Nathan's plan is at ${latest.weekly}% of its week, where the runner starts no Claude` };
  }
  const weekElapsed = Math.min(1, Math.max(0, 1 - (latest.weeklyResetsAt.getTime() - now.getTime()) / WEEK_MS));
  return { kind: "measured", usedPercent: usageShare(snapshot, CLAUDE_RUN_TAGS.x), allowedPercent: X_SHARE_PERCENT * weekElapsed };
}

const describeUse = (share: Extract<XShare, { kind: "measured" }>) =>
  `X has used ${share.usedPercent.toFixed(2)}% of Nathan's week and may use ${share.allowedPercent.toFixed(2)}% by now (${X_SHARE_PERCENT}% by the reset)`;

/** Why a tweet that draws Claude cannot go to Claude now, or null when it can. */
export function xShareProblem(share: XShare): string | null {
  if (share.kind === "runner_down") return share.reason;
  return share.usedPercent < share.allowedPercent ? null : describeUse(share);
}

/** Reads the share once, logs it, and says why this X run cannot send tweets
 *  to Claude, or null when it can. */
export async function claudeUnavailableReason(): Promise<string | null> {
  const share = computeXShare({ now: new Date(), ...(await readUsageSnapshot()) });
  const problem = xShareProblem(share);
  if (problem) console.log(`[claude] ${problem}. Tweets that draw Claude fail in this run.`);
  else if (share.kind === "measured") console.log(`[claude] ${describeUse(share)}. Tweets that draw Claude go to the ai-box.`);
  return problem;
}
