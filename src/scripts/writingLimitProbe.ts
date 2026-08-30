/**
 * Writing Limit Probe — read-only.
 *
 * Fetches every note this account has written from X's notes_written API and
 * prints the writing-limit formula's inputs (NH_5, NH_10, HR_R, HR_100,
 * HR_14d, DN_30) plus the cap the formula predicts. Writes nothing anywhere —
 * this exists purely so we can watch WHY the daily cap moves.
 *
 * The formula is the community-documented reconstruction of X's limit, ported
 * from the disabled updateWritingLimit.ts. That module was retired because
 * feeding its prediction back into pipeline state misbehaved; printing the
 * variables has no such failure mode.
 */

import axios from "axios";
import { getOAuth1Headers } from "../api/getOAuthToken";

type WrittenNote = { id: string; status: string | undefined };

const API_URL = "https://api.x.com/2/notes/search/notes_written";

function snowflakeToTimestamp(id: string): number {
  return Number((BigInt(id) >> 22n) + 1288834974657n);
}

async function fetchNotesWritten(): Promise<WrittenNote[]> {
  const all: WrittenNote[] = [];
  let nextToken: string | undefined;
  while (true) {
    const params = new URLSearchParams({
      test_mode: "false",
      max_results: "100",
      "note.fields": "id,status",
    });
    if (nextToken) params.append("pagination_token", nextToken);
    const url = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
    const res = await axios.get(url, {
      headers: { ...getOAuth1Headers(url, "GET"), "Content-Type": "application/json" },
      timeout: 30_000,
    });
    for (const n of res.data.data ?? []) all.push({ id: n.id, status: n.status });
    nextToken = res.data.meta?.next_token;
    if (!nextToken) break;
  }
  return all;
}

function hitRate(notes: WrittenNote[]): number {
  if (notes.length === 0) return 0;
  const crh = notes.filter((n) => n.status === "currently_rated_helpful").length;
  const crnh = notes.filter((n) => n.status === "currently_rated_not_helpful").length;
  return (crh - crnh) / notes.length;
}

const notes = await fetchNotesWritten();
const sorted = [...notes].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

const nonNmr = sorted.filter((n) => n.status !== "needs_more_ratings");
const NH_5 = nonNmr.slice(0, 5).filter((n) => n.status === "currently_rated_not_helpful").length;
const NH_10 = nonNmr.slice(0, 10).filter((n) => n.status === "currently_rated_not_helpful").length;
const HR_R = hitRate(sorted.slice(0, 20));
const HR_100 = hitRate(sorted.slice(0, 100));

const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
const HR_14d = hitRate(
  sorted.filter((n) => snowflakeToTimestamp(n.id) >= fourteenDaysAgo && n.status !== "minimum_ratings_not_met"),
);
const HR_L = Math.max(HR_100, HR_14d);

const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
const DN_30 = sorted.filter((n) => snowflakeToTimestamp(n.id) >= thirtyDaysAgo).length / 30;

let WL_L: number | null = null;
let WL: number;
let branch: string;
if (NH_10 >= 8) {
  WL = 2;
  branch = "NH_10 >= 8 (severe punishment)";
} else if (NH_5 >= 3) {
  WL = 5;
  branch = "NH_5 >= 3 (punishment cliff)";
} else if (sorted.length < 20) {
  WL = 10;
  branch = "T < 20 (new writer)";
} else {
  if (HR_L < 0.05) WL_L = 300 * Math.max(HR_R, HR_L);
  else if (HR_L < 0.1) WL_L = 15 + 700 * (HR_L - 0.05);
  else if (HR_L < 0.15) WL_L = 50 + 3000 * (HR_L - 0.1);
  else if (HR_L < 0.2) WL_L = 200 + 6000 * (HR_L - 0.15);
  else WL_L = 500;
  WL = Math.max(5, Math.floor(Math.min(DN_30 * 5, WL_L)));
  branch = "standard formula";
}

const statusCounts: Record<string, number> = {};
for (const n of sorted) {
  const s = n.status ?? "unknown";
  statusCounts[s] = (statusCounts[s] ?? 0) + 1;
}

console.log(`Notes fetched: ${sorted.length}`);
console.log(`Status counts: ${JSON.stringify(statusCounts)}`);
console.log("");
console.log(`NH_5   = ${NH_5}      CRNH among last 5 non-NMR notes`);
console.log(`NH_10  = ${NH_10}      CRNH among last 10 non-NMR notes`);
console.log(`HR_R   = ${HR_R.toFixed(4)} hit rate, last 20 notes`);
console.log(`HR_100 = ${HR_100.toFixed(4)} hit rate, last 100 notes`);
console.log(`HR_14d = ${HR_14d.toFixed(4)} hit rate, last 14 days (excl. min-ratings-not-met)`);
console.log(`HR_L   = ${HR_L.toFixed(4)} max(HR_100, HR_14d) — the operative rate`);
console.log(`DN_30  = ${DN_30.toFixed(2)}   average notes/day, last 30 days`);
console.log("");
console.log(`Branch: ${branch}`);
console.log(`WL_L (quality term)  = ${WL_L === null ? "n/a" : WL_L.toFixed(1)}`);
console.log(`DN_30 * 5 (volume term) = ${(DN_30 * 5).toFixed(0)}`);
console.log(`Predicted writing limit = ${WL}`);
console.log(
  `Binding constraint: ${WL_L !== null && DN_30 * 5 < WL_L ? "VOLUME (DN_30*5)" : "QUALITY (WL_L)"}`,
);
