/**
 * The bar a finished note must clear to be submitted, on the note rater's
 * score. It is a percentile of the scores of the last month's notes, so it
 * rises on its own as the pool of written notes grows. Notes below it are
 * rejected, except a random slice (EXPLORE_SHARE in capacity/window.ts) that
 * is submitted anyway and logged as explored, so the rater's rejections keep
 * getting outcomes and a rater that has stopped working can be seen.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";

export const RATER_BAR_WINDOW_DAYS = 30;
// Fewer scores than this and there is no bar: everything rated is submitted.
export const RATER_BAR_MIN_SCORES = 50;

/** The share of recent notes that clear the bar. Repo variable
 *  NOTE_BAR_KEEP_SHARE, default 0.5 (the top half). 1 means no bar. */
export function raterBarKeepShare(): number {
  const v = Number(process.env.NOTE_BAR_KEEP_SHARE);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.5;
}

/** The score at the (1 - keepShare) quantile of `scores`, or null when there
 *  are too few of them. */
export function raterBarFrom(scores: number[], keepShare: number): number | null {
  if (scores.length < RATER_BAR_MIN_SCORES || keepShare >= 1) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * (1 - keepShare))));
  return sorted[idx]!;
}

export async function raterBar(logger: SupabaseLogger): Promise<number | null> {
  const scores = await logger.fetchNoteRaterScores(RATER_BAR_WINDOW_DAYS);
  const bar = raterBarFrom(scores, raterBarKeepShare());
  console.log(`[raterBar] ${scores.length} rater scores in the last ${RATER_BAR_WINDOW_DAYS} days; keep share ${raterBarKeepShare()}; bar ${bar === null ? "none" : bar.toFixed(3)}`);
  return bar;
}
