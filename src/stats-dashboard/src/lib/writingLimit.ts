import { formatSignedPercent } from "./format";
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

export interface WlInputs {
  NH_5: number;
  NH_10: number;
  T: number;
  DN_30: number;
  HR_R: number;
  HR_L: number;
  WL_L: number;
}

// Case definitions for the WL_L cascade. Each case carries:
//   - upperBound: the threshold for "If HR_L < upperBound" (Infinity = "else")
//   - conditionLabel / formulaLabel: static display text (matches the spec)
//   - resolve: numeric computation + the resolved-with-numbers label string
// Single source of truth so computeWlL and the dashboard cannot drift.
export interface WlLCase {
  branch: WlLBranch;
  upperBound: number;
  conditionLabel: string;
  formulaLabel: string;
  resolve(hrL: number, hrR: number): { value: number; resolvedLabel: string };
}

export const WL_L_CASES: readonly WlLCase[] = [
  {
    branch: 0,
    upperBound: 0.05,
    conditionLabel: "If HR_L < 5%:",
    formulaLabel: "WL_L = 300 × max(HR_R, HR_L)",
    resolve: (hrL, hrR) => {
      const value = 300 * Math.max(hrR, hrL);
      return {
        value,
        resolvedLabel: `WL_L = 300 × max(${formatSignedPercent(hrR)}, ${formatSignedPercent(hrL)}) = ${value.toFixed(2)}`,
      };
    },
  },
  {
    branch: 1,
    upperBound: 0.10,
    conditionLabel: "Else If HR_L < 10%:",
    formulaLabel: "WL_L = 15 + 700 × (HR_L - 5%)",
    resolve: (hrL) => {
      const value = 15 + 700 * (hrL - 0.05);
      return {
        value,
        resolvedLabel: `WL_L = 15 + 700 × (${formatSignedPercent(hrL)} - 5%) = ${value.toFixed(2)}`,
      };
    },
  },
  {
    branch: 2,
    upperBound: 0.15,
    conditionLabel: "Else If HR_L < 15%:",
    formulaLabel: "WL_L = 50 + 3000 × (HR_L - 10%)",
    resolve: (hrL) => {
      const value = 50 + 3000 * (hrL - 0.10);
      return {
        value,
        resolvedLabel: `WL_L = 50 + 3000 × (${formatSignedPercent(hrL)} - 10%) = ${value.toFixed(2)}`,
      };
    },
  },
  {
    branch: 3,
    upperBound: 0.20,
    conditionLabel: "Else If HR_L < 20%:",
    formulaLabel: "WL_L = 200 + 6000 × (HR_L - 15%)",
    resolve: (hrL) => {
      const value = 200 + 6000 * (hrL - 0.15);
      return {
        value,
        resolvedLabel: `WL_L = 200 + 6000 × (${formatSignedPercent(hrL)} - 15%) = ${value.toFixed(2)}`,
      };
    },
  },
  {
    branch: 4,
    upperBound: Infinity,
    conditionLabel: "Else:",
    formulaLabel: "WL_L = 500",
    resolve: () => ({ value: 500, resolvedLabel: "WL_L = 500" }),
  },
];

function pickWlLCase(hrL: number): WlLCase {
  // Cases are ordered by ascending upperBound; the last has Infinity, so .find always matches.
  return WL_L_CASES.find((c) => hrL < c.upperBound)!;
}

// Case definitions for the outer WL cascade.
export interface WlCase {
  key: WlBranch;
  conditionLabel: string;
  formulaLabel: string;
  test(inputs: WlInputs): boolean;
  resolve(inputs: WlInputs): { value: number; resolvedLabel: string };
}

export const WL_CASES: readonly WlCase[] = [
  {
    key: "nh10",
    conditionLabel: "If NH_10 ≥ 8:",
    formulaLabel: "WL = 2",
    test: (i) => i.NH_10 >= 8,
    resolve: () => ({ value: 2, resolvedLabel: "WL = 2" }),
  },
  {
    key: "nh5",
    conditionLabel: "Else If NH_5 ≥ 3:",
    formulaLabel: "WL = 5",
    test: (i) => i.NH_5 >= 3,
    resolve: () => ({ value: 5, resolvedLabel: "WL = 5" }),
  },
  {
    key: "newWriter",
    conditionLabel: "Else If T < 20 (new writer):",
    formulaLabel: "WL = 10",
    test: (i) => i.T < 20,
    resolve: () => ({ value: 10, resolvedLabel: "WL = 10" }),
  },
  {
    key: "main",
    conditionLabel: "Else:",
    formulaLabel: "WL = max(5, floor(min(DN_30 × 5, WL_L)))",
    test: () => true,
    resolve: (i) => {
      const dn30x5 = i.DN_30 * 5;
      const value = Math.max(5, Math.floor(Math.min(dn30x5, i.WL_L)));
      return {
        value,
        resolvedLabel: `WL = max(5, floor(min(${dn30x5.toFixed(2)}, ${i.WL_L.toFixed(2)}))) = ${value}`,
      };
    },
  },
];

function pickWlCase(inputs: WlInputs): WlCase {
  return WL_CASES.find((c) => c.test(inputs))!;
}

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
  wlLBranch: WlLBranch;
  WL: number;
  wlBranch: WlBranch;
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
  const wlLCase = pickWlLCase(HR_L);
  const { value: WL_L } = wlLCase.resolve(HR_L, HR_R);

  const wlInputs: WlInputs = { NH_5, NH_10, T, DN_30, HR_R, HR_L, WL_L };
  const wlCase = pickWlCase(wlInputs);
  const { value: WL } = wlCase.resolve(wlInputs);

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
    wlLBranch: wlLCase.branch,
    WL,
    wlBranch: wlCase.key,
    crnhRate100,
    impact90d,
    highPerformingLargeXl,
    highPerformingXxl,
  };
}
