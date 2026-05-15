import type { NoteRecord } from "./types";

const CRH = "CURRENTLY_RATED_HELPFUL";
const CRNH = "CURRENTLY_RATED_NOT_HELPFUL";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const HR_14D_MIN_RATINGS = 10;

const HP_LARGE_MIN_NOTES = 100;
const HP_LARGE_MIN_HR_L = 0.05;
const HP_LARGE_MAX_CRNH_RATE = 0.10;
const HP_XXL_MIN_IMPACT = 100;

export type WlBranch = "nh10" | "nh5" | "newWriter" | "main";
export type WlLBranch = 0 | 1 | 2 | 3 | 4;

function hitRate(notes: NoteRecord[]): number | null {
  if (!notes.length) return null;
  const crh = notes.filter((n) => n.cn_status === CRH).length;
  const crnh = notes.filter((n) => n.cn_status === CRNH).length;
  return (crh - crnh) / notes.length;
}

function crnhRate(notes: NoteRecord[]): number | null {
  if (!notes.length) return null;
  const crnh = notes.filter((n) => n.cn_status === CRNH).length;
  return crnh / notes.length;
}

function writingImpact(notes: NoteRecord[]): number {
  const crh = notes.filter((n) => n.cn_status === CRH).length;
  const crnh = notes.filter((n) => n.cn_status === CRNH).length;
  return crh - crnh;
}

function computeWlL(hrL: number, hrR: number): { value: number; branch: WlLBranch } {
  if (hrL < 0.05) return { value: 300 * Math.max(hrR, hrL), branch: 0 };
  if (hrL < 0.10) return { value: 15 + 700 * (hrL - 0.05), branch: 1 };
  if (hrL < 0.15) return { value: 50 + 3000 * (hrL - 0.10), branch: 2 };
  if (hrL < 0.20) return { value: 200 + 6000 * (hrL - 0.15), branch: 3 };
  return { value: 500, branch: 4 };
}

export interface WritingLimitMetrics {
  T: number;
  DN_30: number;
  NH_5: number;
  NH_10: number;
  HR_R: number;
  HR_100: number;
  HR_14d: number | null;            // null when we lack ratings in the last 14d window
  HR_14dHasRatings: boolean;
  HR_L: number;
  WL_L: number;                     // always computed (even when an early branch short-circuits WL)
  wlLBranch: WlLBranch;             // which case in the WL_L cascade matched HR_L
  WL: number;
  wlBranch: WlBranch;               // which top-level case in the WL cascade determined WL
  crnhRate100: number | null;
  impact90d: number;
  highPerformingLargeXl: boolean;
  highPerformingXxl: boolean;
}

export function computeWritingLimitMetrics(notes: NoteRecord[]): WritingLimitMetrics | null {
  if (!notes.length) return null;

  // Most recent first.
  const sorted = [...notes].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const now = Date.now();
  const T = sorted.length;
  const cutoff14 = now - FOURTEEN_DAYS_MS;
  const cutoff30 = now - THIRTY_DAYS_MS;
  const cutoff90 = now - NINETY_DAYS_MS;

  const notes14d = sorted.filter((n) => Date.parse(n.submitted_at) >= cutoff14);
  const notes30d = sorted.filter((n) => Date.parse(n.submitted_at) >= cutoff30);
  const notes90d = sorted.filter((n) => Date.parse(n.submitted_at) >= cutoff90);

  const DN_30 = notes30d.length / 30;

  const nonNmr = sorted.filter((n) => n.cn_status === CRH || n.cn_status === CRNH);
  const last5NonNmr = nonNmr.slice(0, 5);
  const last10NonNmr = nonNmr.slice(0, 10);
  const NH_5 = last5NonNmr.filter((n) => n.cn_status === CRNH).length;
  const NH_10 = last10NonNmr.filter((n) => n.cn_status === CRNH).length;

  const last20 = sorted.slice(0, 20);
  const last100 = sorted.slice(0, 100);
  const HR_R = hitRate(last20) ?? 0;
  const HR_100 = hitRate(last100) ?? 0;

  // HR_14d: exclude notes with <10 ratings that haven't been assigned a helpful
  // or not-helpful status. We only have rating counts when X has listed our
  // notewriter as high-performing (the public data dump only covers those).
  // Without rating counts the exclusion criterion can't be applied, so the
  // algorithm's output isn't meaningful — hide it.
  const has14dRatings = notes14d.some((n) => n.rating_count > 0);
  const qualifying14d = notes14d.filter(
    (n) => n.rating_count >= HR_14D_MIN_RATINGS || n.cn_status === CRH || n.cn_status === CRNH,
  );
  const HR_14d = has14dRatings ? hitRate(qualifying14d) : null;
  const HR_L = HR_14d == null ? HR_100 : Math.max(HR_100, HR_14d);

  // Always compute WL_L so the dashboard can show what it would have been even
  // when an early branch short-circuits the WL cascade.
  const { value: WL_L, branch: wlLBranch } = computeWlL(HR_L, HR_R);

  let WL: number;
  let wlBranch: WlBranch;
  if (NH_10 >= 8) {
    WL = 2;
    wlBranch = "nh10";
  } else if (NH_5 >= 3) {
    WL = 5;
    wlBranch = "nh5";
  } else if (T < 20) {
    WL = 10;
    wlBranch = "newWriter";
  } else {
    WL = Math.max(5, Math.floor(Math.min(DN_30 * 5, WL_L)));
    wlBranch = "main";
  }

  const crnhRate100 = crnhRate(last100);
  const impact90d = writingImpact(notes90d);
  const highPerformingLargeXl =
    T >= HP_LARGE_MIN_NOTES &&
    HR_L >= HP_LARGE_MIN_HR_L &&
    crnhRate100 != null &&
    crnhRate100 <= HP_LARGE_MAX_CRNH_RATE;
  const highPerformingXxl = highPerformingLargeXl && impact90d >= HP_XXL_MIN_IMPACT;

  return {
    T,
    DN_30,
    NH_5,
    NH_10,
    HR_R,
    HR_100,
    HR_14d,
    HR_14dHasRatings: has14dRatings,
    HR_L,
    WL_L,
    wlLBranch,
    WL,
    wlBranch,
    crnhRate100,
    impact90d,
    highPerformingLargeXl,
    highPerformingXxl,
  };
}
