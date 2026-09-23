/**
 * The bar a finished note must clear to be submitted: its calibrated chance of
 * being rated helpful must exceed its calibrated chance of being rated not
 * helpful by at least NOTE_BAR_MIN_NET (repo variable, default 0.05). That is
 * about our hit rate today, so posting only notes above it raises the average,
 * and we post as many such notes as X allows. Notes below it are rejected,
 * except a random slice (EXPLORE_SHARE in capacity/window.ts) that is
 * submitted anyway and logged as explored, so the rater's rejections keep
 * getting outcomes and a rater that has stopped working can be seen.
 */

export const DEFAULT_BAR_MIN_NET = 0.05;

/** The bar, or null for no bar (NOTE_BAR_MIN_NET set to "off" or a negative number). */
export function raterBar(): number | null {
  const raw = process.env.NOTE_BAR_MIN_NET?.trim();
  if (raw === undefined || raw === "") return DEFAULT_BAR_MIN_NET;
  if (raw.toLowerCase() === "off") return null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return DEFAULT_BAR_MIN_NET;
  return v < 0 ? null : v;
}
