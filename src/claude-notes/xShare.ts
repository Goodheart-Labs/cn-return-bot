/* The X note writers' shares of the Claude plan they run on (GOO-527,
 * GOO-617, GOO-851).
 *
 * The runner on the ai-box writes Common Notes and, since GOO-527, notes for
 * some of the X bot's tweets. Since GOO-787 (2026-11-19) both are paid for by
 * Jim's notewriter account, a Claude plan used for nothing else. Jim gave X
 * 20% of the week on 2026-10-27 and 30% on 2026-11-19, and Common Notes the
 * rest of the weekly target that usagePacing.ts aims at. Each X account has a
 * share of its own (src/api/xAccount.ts). The WSDM Cup account got 30% on
 * 2026-11-23, on top of the first account's 30%. Since GOO-874 (2026-11-24)
 * the first account writes no notes, so on 2026-11-25 its share went to 0%
 * (GOO-875). The WSDM Cup account keeps its 30%, and Common Notes gets the
 * rest.
 *
 * How much of the week an account used so far is its tag's share of the plan's usage
 * (src/claude-notes/usageShare.ts), split by the API-equivalent cost of every
 * Claude run of the notewriter that takes the tweets. Only that notewriter's
 * readings and runs count, so Nathan's hq posts, which run on his own plan,
 * do not water the share down.
 *
 * X may not use its whole share at the start of the week. Its allowance grows
 * evenly from 0% at the weekly reset to the whole share at the next one.
 * Without that, the tweets would use up the share in a few days, and X would
 * get no Claude notes for the rest of the week.
 *
 * The X run reads this once at its start. While X is over its allowance, or
 * the runner on the ai-box would not start a Claude, a tweet that draws Claude
 * fails like a tweet whose model provider is out of credits (Jim,
 * 2026-10-28). It is not moved to the pipeline. Common Notes needs no change: its pacing aims the plan's total at its target, and X's
 * usage is part of that total, so Common Notes gets whatever X leaves. */

import { MAX_USAGE_READING_AGE_MS, MAX_WEEKLY_USAGE_PERCENT } from "../everything/usagePacing";
import { currentXAccount, type XAccount } from "../api/xAccount";
import { AI_BOX_NOTEWRITER } from "../notewriters/ids";
import { CLAUDE_RUN_TAGS, readUsageSnapshot, usageShare, type ClaudeRunTag, type UsageSnapshot } from "./usageShare";

/** The tag on each account's Claude runs, and its share of the week in percent. */
export const X_SHARES: Record<XAccount, { tag: ClaudeRunTag; percent: number }> = {
  stilt: { tag: CLAUDE_RUN_TAGS.x, percent: 0 },
  wsdm: { tag: CLAUDE_RUN_TAGS.xWsdm, percent: 30 },
};
const WEEK_MS = 7 * 24 * 3600_000;

export type XShareSnapshot = UsageSnapshot & { now: Date };

export type XShare =
  | { kind: "measured"; account: XAccount; usedPercent: number; allowedPercent: number }
  /** The runner on the ai-box would not start a Claude now. */
  | { kind: "runner_down"; reason: string };


export function computeXShare(snapshot: XShareSnapshot, account: XAccount): XShare {
  const { latest, now } = snapshot;
  if (!latest || now.getTime() - latest.at.getTime() > MAX_USAGE_READING_AGE_MS) {
    return { kind: "runner_down", reason: "The runner on ai-box has not reported the usage of its Claude plan in the last 30 minutes" };
  }
  if (latest.weekly >= MAX_WEEKLY_USAGE_PERCENT) {
    return { kind: "runner_down", reason: `The note writer's plan is at ${latest.weekly}% of its week, where the runner starts no Claude` };
  }
  const weekElapsed = Math.min(1, Math.max(0, 1 - (latest.weeklyResetsAt.getTime() - now.getTime()) / WEEK_MS));
  const { tag, percent } = X_SHARES[account];
  return { kind: "measured", account, usedPercent: usageShare(snapshot, tag), allowedPercent: percent * weekElapsed };
}

const describeUse = (share: Extract<XShare, { kind: "measured" }>) =>
  `X account ${share.account} has used ${share.usedPercent.toFixed(2)}% of the note writer's week and may use ${share.allowedPercent.toFixed(2)}% by now (${X_SHARES[share.account].percent}% by the reset)`;

/** Why a tweet that draws Claude cannot go to Claude now, or null when it can. */
export function xShareProblem(share: XShare): string | null {
  if (share.kind === "runner_down") return share.reason;
  return share.usedPercent < share.allowedPercent ? null : describeUse(share);
}

/** Reads the share of this process's X account once, logs it, and says why
 *  it cannot send tweets to Claude, or null when it can. */
export async function claudeUnavailableReason(): Promise<string | null> {
  // The X run's Claude tweets go to the runner on the ai-box.
  const share = computeXShare({ now: new Date(), ...(await readUsageSnapshot(AI_BOX_NOTEWRITER)) }, currentXAccount());
  const problem = xShareProblem(share);
  if (problem) console.log(`[claude] ${problem}. Tweets that draw Claude fail in this run.`);
  else if (share.kind === "measured") console.log(`[claude] ${describeUse(share)}. Tweets that draw Claude go to the ai-box.`);
  return problem;
}
