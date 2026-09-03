import type { SupabaseLogger } from "../../api/supabaseClient";

const SUBMISSION_WINDOW_HOURS = 24;
export const BAR_WINDOW_DAYS = 7;
export const BAR_FLOOR_WINDOW_DAYS = 30;
const MIN_DAYS_OF_DECISIONS = 3;
export const EXPLORE_SHARE = 0.1;

export interface Window {
  cap: number | null;
  capSource: "last_403" | "writing_limit" | "unknown";
  used24h: number;
  remaining: number | null;
}

export async function estimateWindow(logger: SupabaseLogger): Promise<Window> {
  const used24h = await logger.countRecentSubmissions(SUBMISSION_WINDOW_HOURS);
  const hitAt = Date.parse((await logger.getPipelineState("limit_hit_at")) ?? "");
  const hitValue = Number(await logger.getPipelineState("limit_hit_value"));
  const stored = Number(await logger.getPipelineState("writing_limit"));
  const recentHit = Number.isFinite(hitAt) && Date.now() - hitAt < SUBMISSION_WINDOW_HOURS * 3_600_000;
  let cap: number | null = null;
  let capSource: Window["capSource"] = "unknown";
  if (recentHit && Number.isFinite(hitValue) && hitValue > 0 && used24h <= hitValue) {
    cap = hitValue;
    capSource = "last_403";
  } else if (Number.isFinite(stored) && stored > 0) {
    cap = stored;
    capSource = "writing_limit";
  }
  return { cap, capSource, used24h, remaining: cap === null ? null : Math.max(0, cap - used24h) };
}

// The score at which `scores` (submit scores of every candidate over `days`) would
// have yielded `perDay` submissions per day. Null when there isn't enough history.
export function quantileBar(scores: number[], days: number, perDay: number): number | null {
  if (days < MIN_DAYS_OF_DECISIONS || scores.length === 0) return null;
  const want = Math.round(perDay * days);
  if (want <= 0) return Infinity;
  if (want >= scores.length) return -Infinity;
  const sorted = [...scores].sort((a, b) => b - a);
  return sorted[want - 1] ?? null;
}

// Trailing-week bar, never below the trailing-month bar.
export function barWithFloor(
  week: { scores: number[]; days: number },
  month: { scores: number[]; days: number },
  cap: number,
): number | null {
  const bar7 = quantileBar(week.scores, week.days, cap);
  const bar30 = quantileBar(month.scores, month.days, cap);
  if (bar7 === null) return bar30;
  if (bar30 === null) return bar7;
  return Math.max(bar7, bar30);
}

export async function barFor(logger: SupabaseLogger, scorerName: string, cap: number): Promise<number | null> {
  const [week, month] = await Promise.all([
    logger.fetchRankingSubmitScores(scorerName, BAR_WINDOW_DAYS),
    logger.fetchRankingSubmitScores(scorerName, BAR_FLOOR_WINDOW_DAYS),
  ]);
  return barWithFloor(week, month, cap);
}

// On by default. Set the repo variable CAPACITY_BAR_ENABLED=false to switch it off.
export function barEnabled(): boolean {
  return process.env.CAPACITY_BAR_ENABLED !== "false";
}
