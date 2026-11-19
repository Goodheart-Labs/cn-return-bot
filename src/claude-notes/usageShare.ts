/* Which part of a notewriter's Claude plan each kind of Claude run used
 * (GOO-612).
 *
 * Every Claude that a runner starts writes one row to everything_claude_runs
 * when it ends (recordClaudeRun in store.ts), with the notewriter whose plan
 * paid for it (GOO-787). The row
 * has tags that say what the run was for, and what the run would have cost on
 * the API, as Claude Code reports it. Anthropic's usage endpoint only reports
 * the plan's total, so a tag's share of the week is estimated: the usage that
 * rose since the week's first run with a cost, times the tag's part of all of
 * the week's costs.
 *
 * Counting from the first cost matters in the week this was deployed, because
 * the usage from before then has no rows. Any other work on the plan has no
 * row either, so it would make every tag's share look bigger than it is. The split
 * also assumes that the plan counts every model in proportion to its API
 * price. */

import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows } from "../everything-core/paging";

/** A run has one product tag and one tag for its kind. */
export const CLAUDE_RUN_TAGS = {
  commonNotes: "common-notes",
  x: "x",
  post: "post",
  tweet: "tweet",
  judge: "judge",
  reviewAnswer: "review-answer",
  xAccount: "x-account",
} as const;
export type ClaudeRunTag = (typeof CLAUDE_RUN_TAGS)[keyof typeof CLAUDE_RUN_TAGS];

const WEEK_MS = 7 * 24 * 3600_000;

export interface UsageSnapshot {
  latest: { at: Date; weekly: number; weeklyResetsAt: Date } | null;
  /** The runs of this week that reported a cost. */
  runs: { tags: string[]; apiCostUsd: number }[];
  /** The weekly usage just before the week's first run with a cost. */
  weeklyBeforeCosts: number;
}

const sumCosts = (runs: UsageSnapshot["runs"]) => runs.reduce((sum, run) => sum + run.apiCostUsd, 0);

/** The percentage points of the plan's week that the runs with this tag used. */
export function usageShare(snapshot: UsageSnapshot, tag: ClaudeRunTag): number {
  const { latest, runs, weeklyBeforeCosts } = snapshot;
  const totalCost = sumCosts(runs);
  if (!latest || totalCost === 0) return 0;
  const riseSinceCosts = Math.max(0, latest.weekly - weeklyBeforeCosts);
  return (riseSinceCosts * sumCosts(runs.filter((run) => run.tags.includes(tag)))) / totalCost;
}

/** The usage reading just before `at`, or 0 when the week has none yet. */
async function weeklyBefore(notewriter: string, at: string, weekStart: string): Promise<number> {
  const { data, error } = await getSupabaseClient()
    .from("everything_claude_usage")
    .select("weekly")
    .eq("notewriter", notewriter)
    .gte("at", weekStart)
    .lte("at", at)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data?.weekly ?? 0;
}

/** The week so far of one notewriter's Claude plan: its readings and its runs. */
export async function readUsageSnapshot(notewriter: string): Promise<UsageSnapshot> {
  const db = getSupabaseClient();
  const { data: latest, error } = await db
    .from("everything_claude_usage")
    .select("at, weekly, weekly_resets_at")
    .eq("notewriter", notewriter)
    .not("weekly_resets_at", "is", null)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!latest) return { latest: null, runs: [], weeklyBeforeCosts: 0 };
  const weeklyResetsAt = new Date(latest.weekly_resets_at!);
  const weekStart = new Date(weeklyResetsAt.getTime() - WEEK_MS).toISOString();
  const rows = await fetchAllRows<{ id: string; started_at: string; tags: string[]; api_cost_usd: number }>(
    () => db.from("everything_claude_runs").select("id, started_at, tags, api_cost_usd").eq("notewriter", notewriter).gte("started_at", weekStart).gt("api_cost_usd", 0),
    "id",
    { label: "claudeRunCosts" },
  );
  const firstCostAt = rows.map((row) => row.started_at).sort()[0];
  return {
    latest: { at: new Date(latest.at), weekly: latest.weekly, weeklyResetsAt },
    runs: rows.map((row) => ({ tags: row.tags, apiCostUsd: Number(row.api_cost_usd) })),
    weeklyBeforeCosts: firstCostAt ? await weeklyBefore(notewriter, firstCostAt, weekStart) : latest.weekly,
  };
}
