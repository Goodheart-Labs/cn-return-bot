/* The X note writer's share of Nathan's Claude plan (GOO-527, GOO-617).
 *
 * The Claude Code note writer on the ai-box writes Common Notes and, since
 * GOO-527, notes for some of the X bot's tweets. Both are paid for by Nathan's
 * Claude subscription. Jim gave X 20% of the week on 2026-10-27, and Common
 * Notes the rest of the 80% that usagePacing.ts aims at.
 *
 * Anthropic's usage endpoint reports only the plan's total, so the X share is
 * estimated. Every Claude run ends with the cost Claude Code reports for it,
 * which is what the run would have cost on the API. The runner stores that
 * cost on each X tweet's pipeline_runs row and on each Common Notes post's
 * item_finished event. The X share of the week's usage so far is then the
 * usage that rose since the week's first run with a cost, times the X runs'
 * part of that cost. Counting from the first cost matters in the week this
 * was deployed: the usage from before then has no cost rows, and it belonged
 * to Common Notes alone. Nathan's own work on the plan has no cost row either,
 * so it makes both shares look bigger. For X that only means it stops a
 * little early.
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

import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows } from "../everything-core/paging";
import { MAX_USAGE_READING_AGE_MS, MAX_WEEKLY_USAGE_PERCENT } from "../everything/usagePacing";
import { CLAUDE_CODE_BOT } from "../pipeline/orchestration/claudeTweets";
export const X_SHARE_PERCENT = 20;
const WEEK_MS = 7 * 24 * 3600_000;

export interface XShareSnapshot {
  now: Date;
  latest: { at: Date; weekly: number; weeklyResetsAt: Date } | null;
  /** What the X Claude runs of this week cost, in API dollars. */
  xCostUsd: number;
  /** What the Common Notes Claude runs of this week cost, in API dollars. */
  commonNotesCostUsd: number;
  /** The weekly usage just before the week's first run with a cost. */
  weeklyBeforeCosts: number;
}

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
  const totalCost = snapshot.xCostUsd + snapshot.commonNotesCostUsd;
  const riseSinceCosts = Math.max(0, latest.weekly - snapshot.weeklyBeforeCosts);
  const usedPercent = totalCost > 0 ? (riseSinceCosts * snapshot.xCostUsd) / totalCost : 0;
  const weekElapsed = Math.min(1, Math.max(0, 1 - (latest.weeklyResetsAt.getTime() - now.getTime()) / WEEK_MS));
  const allowedPercent = X_SHARE_PERCENT * weekElapsed;
  return { kind: "measured", usedPercent, allowedPercent };
}

const describeUse = (share: Extract<XShare, { kind: "measured" }>) =>
  `X has used ${share.usedPercent.toFixed(2)}% of Nathan's week and may use ${share.allowedPercent.toFixed(2)}% by now (${X_SHARE_PERCENT}% by the reset)`;

/** Why a tweet that draws Claude cannot go to Claude now, or null when it can. */
export function xShareProblem(share: XShare): string | null {
  if (share.kind === "runner_down") return share.reason;
  return share.usedPercent < share.allowedPercent ? null : describeUse(share);
}

type CostRow = { at: string; cost: unknown };
const hasCost = (row: CostRow) => Number(row.cost) > 0;
const sumCosts = (rows: CostRow[]) => rows.filter(hasCost).reduce((sum, row) => sum + Number(row.cost), 0);

/** The usage reading just before `at`, or 0 when the week has none yet. */
async function weeklyBefore(at: string, weekStart: string): Promise<number> {
  const { data, error } = await getSupabaseClient()
    .from("everything_claude_usage")
    .select("weekly")
    .gte("at", weekStart)
    .lte("at", at)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data?.weekly ?? 0;
}

export async function readXShareSnapshot(now = new Date()): Promise<XShareSnapshot> {
  const db = getSupabaseClient();
  const { data: latest, error } = await db
    .from("everything_claude_usage")
    .select("at, weekly, weekly_resets_at")
    .not("weekly_resets_at", "is", null)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!latest) return { now, latest: null, xCostUsd: 0, commonNotesCostUsd: 0, weeklyBeforeCosts: 0 };
  const weeklyResetsAt = new Date(latest.weekly_resets_at!);
  const weekStart = new Date(weeklyResetsAt.getTime() - WEEK_MS).toISOString();
  const [xRuns, commonNotesPosts] = await Promise.all([
    fetchAllRows<CostRow & { id: string }>(
      () => db.from("pipeline_runs").select("id, at:created_at, cost:logs->claude->costUsd").eq("bot_name", CLAUDE_CODE_BOT).gte("created_at", weekStart),
      "id",
      { label: "xClaudeCosts" },
    ),
    fetchAllRows<CostRow & { id: number }>(
      () => db.from("everything_claude_events").select("id, at, cost:data->costUsd").eq("type", "item_finished").gte("at", weekStart),
      "id",
      { label: "commonNotesClaudeCosts" },
    ),
  ]);
  const firstCostAt = [...xRuns, ...commonNotesPosts].filter(hasCost).map((row) => row.at).sort()[0];
  return {
    now,
    latest: { at: new Date(latest.at), weekly: latest.weekly, weeklyResetsAt },
    xCostUsd: sumCosts(xRuns),
    commonNotesCostUsd: sumCosts(commonNotesPosts),
    weeklyBeforeCosts: firstCostAt ? await weeklyBefore(firstCostAt, weekStart) : latest.weekly,
  };
}

/** Reads the share once, logs it, and says why this X run cannot send tweets
 *  to Claude, or null when it can. */
export async function claudeUnavailableReason(): Promise<string | null> {
  const share = computeXShare(await readXShareSnapshot());
  const problem = xShareProblem(share);
  if (problem) console.log(`[claude] ${problem}. Tweets that draw Claude fail in this run.`);
  else if (share.kind === "measured") console.log(`[claude] ${describeUse(share)}. Tweets that draw Claude go to the ai-box.`);
  return problem;
}
