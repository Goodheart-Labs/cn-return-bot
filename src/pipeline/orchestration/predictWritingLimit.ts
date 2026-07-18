/**
 * Predict X's current daily writing limit (WL) from our own note history, so the
 * pipeline can budget generation *ahead* of hitting the cap instead of only
 * discovering it by getting a 403 (see writingLimit.ts for the observed-cap path).
 *
 * This reimplements X's published AI-Note-Writer writing-limit formula
 * (https://communitynotes.x.com/guide/en/api/overview) against our Supabase
 * mirror. It was validated on 2026-07-18: fed live data it computed WL≈12, and
 * — the key check — it reproduced X's *exact* observed cap of 9 at the moment X
 * refused a submission (HR_100≈3%, HR_R≈0 → 300×0.03 = 9). See
 * docs/note-ranking-plan.md.
 *
 * Inputs, all from our own data (no per-account X API creds needed):
 *   - status / write-date  → `notes` (cn_status, submitted_at, note_id snowflake)
 *   - rating counts         → `note_ratings_from_public_dump` (for the HR_14d
 *                             "<10 ratings & undecided" exclusion, which X applies)
 */

import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../api/paging";

const CRH = "CURRENTLY_RATED_HELPFUL";
const CRNH = "CURRENTLY_RATED_NOT_HELPFUL";
const NMR = "NEEDS_MORE_RATINGS";

// X's HR_14d excludes notes with <10 ratings that haven't been assigned
// Helpful/Not-Helpful — i.e. too fresh to score. We approximate that with the
// public-dump rating counts.
const MIN_RATINGS_FOR_HR14D = 10;
// We only need the recent windows (most-recent-100, last-14d, last-30d). Pull a
// generous 35-day slice so DN_30 and the 100-note window are always covered,
// without scanning the whole (5k+ row) notes table every run.
const LOOKBACK_DAYS = 35;

type NoteRow = { note_id: string; cn_status: string | null; submitted_at: string | null };

export interface WritingLimitPrediction {
  wl: number;
  branch: string;
  T: number;
  NH_5: number;
  NH_10: number;
  HR_R: number;
  HR_100: number;
  HR_14d: number;
  HR_L: number;
  DN_30: number;
}

function normStatus(s: string | null): string {
  return (s || "").toUpperCase().replace(/\s+/g, "_");
}

/** (CRH − CRNH) / N over the given notes — X's net "hit rate". */
function hitRate(notes: NoteRow[]): number {
  if (notes.length === 0) return 0;
  let crh = 0, crnh = 0;
  for (const n of notes) {
    const s = normStatus(n.cn_status);
    if (s === CRH) crh++;
    else if (s === CRNH) crnh++;
  }
  return (crh - crnh) / notes.length;
}

/**
 * Compute the predicted writing limit from our note history. Returns the full
 * component breakdown so callers can log why the number is what it is.
 * Returns null if we can't read enough data (caller should fall back).
 */
export async function predictWritingLimit(): Promise<WritingLimitPrediction | null> {
  const client = getSupabaseClient();
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let notes: NoteRow[];
  try {
    notes = await fetchAllRows<NoteRow>(
      () =>
        client
          .from("notes")
          .select("note_id, cn_status, submitted_at")
          .not("submitted_at", "is", null)
          .gte("submitted_at", sinceIso),
      "note_id",
      { label: "predictWritingLimit.notes" },
    );
  } catch (err) {
    console.warn("[predict-wl] could not read notes — skipping prediction:", err);
    return null;
  }

  // Real note ids only (snowflakes) — drop tweet_/unavailable_ placeholders.
  notes = notes.filter((n) => /^\d+$/.test(n.note_id));
  if (notes.length === 0) return null;

  // Rating counts for the HR_14d exclusion. Best-effort: if this fails we still
  // predict (HR_14d just won't drop the under-rated NMR notes → conservative).
  const ratingTotals = new Map<string, number>();
  try {
    const ratings = await fetchAllRows<{ note_id: string; helpful_count: number | null; somewhat_helpful_count: number | null; not_helpful_count: number | null }>(
      () => client.from("note_ratings_from_public_dump").select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count"),
      "note_id",
      { label: "predictWritingLimit.ratings" },
    );
    for (const r of ratings) {
      ratingTotals.set(r.note_id, (r.helpful_count || 0) + (r.somewhat_helpful_count || 0) + (r.not_helpful_count || 0));
    }
  } catch (err) {
    console.warn("[predict-wl] could not read rating counts — HR_14d will be conservative:", err);
  }

  // Most-recent-first by note_id (snowflake ≈ note creation time).
  const sorted = [...notes].sort((a, b) => (BigInt(b.note_id) > BigInt(a.note_id) ? 1 : -1));
  const T = sorted.length;

  // NH_5 / NH_10: of the most-recent non-NMR notes, how many are Not Helpful.
  const nonNmr = sorted.filter((n) => normStatus(n.cn_status) !== NMR);
  const countCrnh = (arr: NoteRow[]) => arr.filter((n) => normStatus(n.cn_status) === CRNH).length;
  const NH_5 = countCrnh(nonNmr.slice(0, 5));
  const NH_10 = countCrnh(nonNmr.slice(0, 10));

  const HR_R = hitRate(sorted.slice(0, 20));
  const HR_100 = hitRate(sorted.slice(0, 100));

  // HR_14d: last 14 days, excluding NMR notes with <10 ratings (too fresh).
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const inLast = (n: NoteRow, ms: number) =>
    n.submitted_at != null && new Date(n.submitted_at).getTime() >= Date.now() - ms;
  const qualifying = sorted.filter((n) => {
    if (!n.submitted_at || new Date(n.submitted_at).getTime() < fourteenDaysAgo) return false;
    const isUnderRatedNmr = normStatus(n.cn_status) === NMR && (ratingTotals.get(n.note_id) ?? 0) < MIN_RATINGS_FOR_HR14D;
    return !isUnderRatedNmr;
  });
  const HR_14d = hitRate(qualifying);
  const HR_L = Math.max(HR_100, HR_14d);

  const DN_30 = sorted.filter((n) => inLast(n, 30 * 24 * 60 * 60 * 1000)).length / 30;

  const base = { T, NH_5, NH_10, HR_R, HR_100, HR_14d, HR_L, DN_30 };

  // ── X's writing-limit formula ──────────────────────────────────────────────
  if (NH_10 >= 8) return { ...base, wl: 2, branch: "NH_10>=8" };
  if (NH_5 >= 3) return { ...base, wl: 5, branch: "NH_5>=3" };
  if (T < 20) return { ...base, wl: 10, branch: "T<20 (new writer)" };

  let WL_L: number;
  if (HR_L < 0.05) WL_L = 300 * Math.max(HR_R, HR_L);
  else if (HR_L < 0.1) WL_L = 15 + 700 * (HR_L - 0.05);
  else if (HR_L < 0.15) WL_L = 50 + 3000 * (HR_L - 0.1);
  else if (HR_L < 0.2) WL_L = 200 + 6000 * (HR_L - 0.15);
  else WL_L = 500;

  const wl = Math.max(5, Math.floor(Math.min(DN_30 * 5, WL_L)));
  return { ...base, wl, branch: "standard" };
}
