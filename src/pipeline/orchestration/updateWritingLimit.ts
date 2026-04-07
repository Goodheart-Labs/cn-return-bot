import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";
import type { SupabaseLogger } from "../../api/supabaseClient";

type NoteRatingStatus =
  | "currently_rated_helpful"
  | "currently_rated_not_helpful"
  | "firm_reject"
  | "insufficient_consensus"
  | "minimum_ratings_not_met"
  | "needs_more_ratings"
  | "needs_your_help";

type WrittenNote = {
  id: string;
  status: NoteRatingStatus | undefined;
};

const API_URL = "https://api.x.com/2/notes/search/notes_written";

function snowflakeToTimestamp(id: string): number {
  return Number((BigInt(id) >> 22n) + 1288834974657n);
}

async function fetchNotesWritten(): Promise<WrittenNote[]> {
  const allNotes: WrittenNote[] = [];
  let nextToken: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      test_mode: "false",
      max_results: "100",
      "note.fields": "id,status",
    });
    if (nextToken) params.append("pagination_token", nextToken);

    const fullUrl = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
    const response = await axios.get(fullUrl, {
      headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
      timeout: 30_000,
    });

    const data = response.data;
    if (data.data) {
      for (const note of data.data) {
        allNotes.push({ id: note.id, status: note.status });
      }
    }

    nextToken = data.meta?.next_token;
    if (!nextToken) break;
  }

  return allNotes;
}

function hitRate(notes: WrittenNote[]): number {
  if (notes.length === 0) return 0;
  const crh = notes.filter((n) => n.status === "currently_rated_helpful").length;
  const crnh = notes.filter((n) => n.status === "currently_rated_not_helpful").length;
  return (crh - crnh) / notes.length;
}

type WritingLimitVars = {
  T: number;
  NH_5: number;
  NH_10: number;
  HR_R: number;
  HR_100: number;
  HR_14d: number;
  HR_L: number;
  DN_30: number;
  WL_L: number | null;
  WL: number;
  branch: string;
};

function computeWritingLimit(notes: WrittenNote[]): WritingLimitVars {
  // Sort by ID descending (most recent first)
  const sorted = [...notes].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

  const T = sorted.length;

  // Non-NMR notes for NH_5/NH_10
  const nonNmr = sorted.filter((n) => n.status !== "needs_more_ratings");
  const NH_5 = nonNmr.slice(0, 5).filter((n) => n.status === "currently_rated_not_helpful").length;
  const NH_10 = nonNmr.slice(0, 10).filter((n) => n.status === "currently_rated_not_helpful").length;

  // Hit rates
  const HR_R = hitRate(sorted.slice(0, 20));
  const HR_100 = hitRate(sorted.slice(0, 100));

  // HR_14d: notes from last 14 days, excluding unresolved (NMR + minimum_ratings_not_met)
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recentQualifying = sorted.filter((n) => {
    const ts = snowflakeToTimestamp(n.id);
    if (ts < fourteenDaysAgo) return false;
    return n.status !== "needs_more_ratings" && n.status !== "minimum_ratings_not_met";
  });
  const HR_14d = hitRate(recentQualifying);

  const HR_L = Math.max(HR_100, HR_14d);

  // DN_30: average daily notes in last 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const notesInLast30 = sorted.filter((n) => snowflakeToTimestamp(n.id) >= thirtyDaysAgo).length;
  const DN_30 = notesInLast30 / 30;

  // Compute WL
  if (NH_10 >= 8) {
    return { T, NH_5, NH_10, HR_R, HR_100, HR_14d, HR_L, DN_30, WL_L: null, WL: 2, branch: "NH_10 >= 8" };
  }
  if (NH_5 >= 3) {
    return { T, NH_5, NH_10, HR_R, HR_100, HR_14d, HR_L, DN_30, WL_L: null, WL: 5, branch: "NH_5 >= 3" };
  }
  if (T < 20) {
    return { T, NH_5, NH_10, HR_R, HR_100, HR_14d, HR_L, DN_30, WL_L: null, WL: 10, branch: "T < 20 (new writer)" };
  }

  // WL_L piecewise function
  let WL_L: number;
  if (HR_L < 0.05) {
    WL_L = 300 * Math.max(HR_R, HR_L);
  } else if (HR_L < 0.1) {
    WL_L = 15 + 700 * (HR_L - 0.05);
  } else if (HR_L < 0.15) {
    WL_L = 50 + 3000 * (HR_L - 0.1);
  } else if (HR_L < 0.2) {
    WL_L = 200 + 6000 * (HR_L - 0.15);
  } else {
    WL_L = 500;
  }

  const WL = Math.max(5, Math.floor(Math.min(DN_30 * 5, WL_L)));
  return { T, NH_5, NH_10, HR_R, HR_100, HR_14d, HR_L, DN_30, WL_L, WL, branch: "standard formula" };
}

function logWritingLimit(v: WritingLimitVars, noteCount: number) {
  console.log(`[pipeline] Writing limit: ${v.WL}`);
  console.log("::group::Writing Limit Calculation Details");

  console.log(`Notes fetched from API: ${noteCount}`);
  console.log(`Branch taken: ${v.branch}`);
  console.log("");

  const vars = [
    ["T", v.T, "Total notes written"],
    ["NH_5", v.NH_5, "CRNH among last 5 non-NMR notes"],
    ["NH_10", v.NH_10, "CRNH among last 10 non-NMR notes"],
    ["HR_R", v.HR_R.toFixed(4), "Hit rate among most recent 20 notes"],
    ["HR_100", v.HR_100.toFixed(4), "Hit rate among most recent 100 notes"],
    ["HR_14d", v.HR_14d.toFixed(4), "Hit rate over last 14 days (excl. unresolved)"],
    ["HR_L", v.HR_L.toFixed(4), "Longer-term hit rate: max(HR_100, HR_14d)"],
    ["DN_30", v.DN_30.toFixed(2), "Average daily notes written in last 30 days"],
    ["WL_L", v.WL_L !== null ? v.WL_L.toFixed(2) : "N/A (early exit)", "Internal writing limit (before DN_30 cap)"],
    ["WL", v.WL, "Final writing limit"],
  ] as const;

  for (const [name, value, desc] of vars) {
    console.log(`  ${name.padEnd(8)} = ${String(value).padEnd(12)} ${desc}`);
  }

  console.log("");
  console.log("Formula reference:");
  console.log(`
  WL = Daily writing limit
  WL_L = Internal writing limit (before accounting for delta in writing volume vs DN_30)
  NH_5 = CRNH count among last 5 non-NMR notes
  NH_10 = CRNH count among last 10 non-NMR notes
  HR_R = Recent hit rate: (CRH-CRNH)/TotalNotes among most recent 20 notes
  HR_100 = Hit rate among most recent 100 notes
  HR_14d = Hit rate over last 14 days, excluding notes with <10 ratings not yet Helpful/Not Helpful
  HR_L = max(HR_100, HR_14d)
  DN_30 = Average daily notes written in last 30 days
  T = Total notes written

  If NH_10 >= 8: WL = 2
  Else If NH_5 >= 3: WL = 5
  Else:
    If T < 20 (new writer): WL = 10
    Else:
      If HR_L < 0.05:       WL_L = 300 * max(HR_R, HR_L)
      Else If HR_L < 0.1:   WL_L = 15 + 700 * (HR_L - 0.05)
      Else If HR_L < 0.15:  WL_L = 50 + 3000 * (HR_L - 0.1)
      Else If HR_L < 0.2:   WL_L = 200 + 6000 * (HR_L - 0.15)
      Else:                  WL_L = 500
      WL = max(5, floor(min(DN_30 * 5, WL_L)))
`);
  console.log("::endgroup::");
}

export async function updateWritingLimit(supabaseLogger: SupabaseLogger): Promise<void> {
  try {
    const notes = await fetchNotesWritten();
    console.log(`[pipeline] Fetched ${notes.length} notes from X API for writing limit calculation`);

    const vars = computeWritingLimit(notes);
    logWritingLimit(vars, notes.length);

    await supabaseLogger.setPipelineState("writing_limit", String(vars.WL));
  } catch (err: any) {
    console.warn("[pipeline] Failed to update writing limit:", err.response?.data || err.message || err);
  }
}
