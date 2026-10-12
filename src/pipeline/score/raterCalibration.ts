/**
 * The probability adjustment for the note rater. The rater's raw numbers run
 * far too high (it says about 27% helpful where 11% is real), and the level
 * moves as the helpful rate moves. So each raw probability is mapped through a
 * two-number logistic fit, refit weekly on matured notes with recent ones
 * weighted more (scripts/refitRaterCalibration.ts). The fitted numbers live in
 * pipeline_state under `rater_calibration`; until the first refit the numbers
 * fitted on 2,045 notes as of 12 Sep 2026 apply.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";

export interface Curve { a: number; b: number }
export interface Calibration { helpful: Curve; notHelpful: Curve; fittedAt: string; notes: number }

export const DEFAULT_CALIBRATION: Calibration = {
  helpful: { a: -1.7259, b: 0.3767 },
  notHelpful: { a: -2.43, b: 0.5995 },
  fittedAt: "2026-09-12",
  notes: 2045,
};
export const CALIBRATION_STATE_KEY = "rater_calibration";

const clip = (p: number) => Math.min(0.995, Math.max(0.005, p));
export const logit = (p: number) => Math.log(clip(p) / (1 - clip(p)));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** A raw probability from the rater, adjusted. */
export function calibrate(raw: number, curve: Curve): number {
  return sigmoid(curve.a + curve.b * logit(raw));
}

function isCurve(v: unknown): v is Curve {
  const c = v as Curve | null;
  return !!c && Number.isFinite(c.a) && Number.isFinite(c.b) && c.b > 0;
}
export function parseCalibration(value: string | null): Calibration | null {
  if (!value) return null;
  try {
    const c = JSON.parse(value) as Calibration;
    return isCurve(c.helpful) && isCurve(c.notHelpful) && typeof c.fittedAt === "string" ? c : null;
  } catch { return null; }
}

let cached: Promise<Calibration> | null = null;
/** The current calibration, read once per process. Falls back to the built-in
 *  numbers when the state is missing or unreadable. */
export function loadCalibration(logger: SupabaseLogger | null): Promise<Calibration> {
  if (!cached) {
    cached = (async () => {
      if (!logger) return DEFAULT_CALIBRATION;
      try {
        const c = parseCalibration(await logger.getPipelineState(CALIBRATION_STATE_KEY));
        if (c) { console.log(`[raterCalibration] using the fit of ${c.fittedAt} (${c.notes} notes)`); return c; }
      } catch (err) { console.warn("[raterCalibration] could not read the calibration; using the built-in numbers:", err); }
      return DEFAULT_CALIBRATION;
    })();
  }
  return cached;
}
export function resetCalibrationCache(): void { cached = null; }
