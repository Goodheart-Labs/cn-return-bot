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
 * the first account wrote no notes, so on 2026-11-25 its share went to 0%
 * (GOO-875). The WSDM Cup account keeps its 30%, and Common Notes gets the
 * rest.
 *
 * Since GOO-880 (2026-11-25) the first account writes notes again, but Jim
 * wants it to use only what the WSDM Cup account does not need. Jim's rule:
 * extrapolate the WSDM Cup account's use linearly to the end of the week, and
 * give the first account the rest of the 30%. If the WSDM Cup account used u
 * percent when a fraction f of the week has passed, it will use u / f by the
 * reset, and the first account's share is 30 - u / f. Its allowance grows
 * evenly like every other: by now it may use f * (30 - u / f) = 30 f - u.
 * So the first account may hand tweets to Claude while its own use is below
 * 30 f - u, which is the same as: while both accounts together have used less
 * than the 30 f the WSDM Cup account may use by now. That is what the
 * leftover budget computes. The WSDM Cup account's own check counts only its
 * own runs, so the first account never takes anything from it.
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

/** The tag on each account's Claude runs, and its budget: either a share of
 *  the week in percent, or what another account leaves of its share. */
type XBudget = { tag: ClaudeRunTag } & ({ kind: "share"; percent: number } | { kind: "leftover"; of: XAccount });

export const X_SHARES: Record<XAccount, XBudget> = {
  stilt: { tag: CLAUDE_RUN_TAGS.x, kind: "leftover", of: "wsdm" },
  wsdm: { tag: CLAUDE_RUN_TAGS.xWsdm, kind: "share", percent: 30 },
};

/** The share of the week that the account's budget grows to by the reset. */
function sharePercent(account: XAccount): number {
  const budget = X_SHARES[account];
  return budget.kind === "share" ? budget.percent : sharePercent(budget.of);
}

/** The accounts whose runs count against this account's budget. */
function countedAccounts(account: XAccount): XAccount[] {
  const budget = X_SHARES[account];
  return budget.kind === "share" ? [account] : [account, ...countedAccounts(budget.of)];
}
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
  const usedPercent = countedAccounts(account).reduce((sum, counted) => sum + usageShare(snapshot, X_SHARES[counted].tag), 0);
  return { kind: "measured", account, usedPercent, allowedPercent: sharePercent(account) * weekElapsed };
}

function describeUse(share: Extract<XShare, { kind: "measured" }>): string {
  const counted = countedAccounts(share.account);
  const who = counted.length === 1 ? `X account ${share.account} has` : `X accounts ${counted.join(" and ")} together have`;
  return `${who} used ${share.usedPercent.toFixed(2)}% of the note writer's week and may use ${share.allowedPercent.toFixed(2)}% by now (${sharePercent(share.account)}% by the reset)`;
}

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
