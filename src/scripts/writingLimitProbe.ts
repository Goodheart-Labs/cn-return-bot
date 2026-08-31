/**
 * Writing Limit Probe — read-only with respect to the pipeline.
 *
 * Fetches every note this account has written from X's notes_written API and
 * prints the writing-limit formula's inputs (NH_5, NH_10, HR_R, HR_100,
 * HR_14d, DN_30) plus the cap the formula predicts, so we can watch WHY the
 * daily cap moves.
 *
 * The formula is the community-documented reconstruction of X's limit, ported
 * from the disabled updateWritingLimit.ts. That module was retired because
 * feeding its prediction back into pipeline state misbehaved. This one only
 * ever reads pipeline state and appends to its own table, so it cannot affect
 * posting behaviour.
 *
 * Since 2026-08-24 each run also APPENDS a row to writing_limit_probe_readings
 * (migration 081), because the printed series was expiring with the GitHub
 * Action logs (~90 days). What makes the row worth keeping is the pairing:
 * alongside the prediction it records what X actually allowed — trailing-24h
 * submissions, the stored ratchet value, and the last real 403 and its count.
 * The formula's arithmetic underpredicts our observed cap by roughly 2.4x
 * (2026-08-17..20: posted 87/110/80/91 against predicted 37/38/41/42, no
 * refusal; last 403 was 2026-08-14 at 90), and until both halves live in one
 * row on one day that ratio stays a guess re-derived by hand each time it
 * matters. Persisting is best-effort: a DB failure logs and exits 0, because
 * losing a reading must never turn into a red workflow that gets muted.
 */

import axios from "axios";
import { createClient } from "@supabase/supabase-js";
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
const binding = WL_L !== null && DN_30 * 5 < WL_L ? "VOLUME" : "QUALITY";
console.log(
  `Binding constraint: ${binding === "VOLUME" ? "VOLUME (DN_30*5)" : "QUALITY (WL_L)"}`,
);

// ── The observed half ───────────────────────────────────────────────────────
// Everything above is what the formula THINKS the cap is. What follows is what
// X actually did, so the two can be compared later without re-deriving either.
//
// Three different kinds of number, deliberately kept apart:
//   submitted_24h  — what we got away with. A lower bound on the cap unless a
//                    403 also fired, since we may simply not have had more to
//                    post (which is the usual case: we run under the ceiling).
//   stored_limit   — pipeline_state.writing_limit. A ratchet guess that climbs
//                    +1 per success. NOT an observation, and not even enforced
//                    once 12h pass without a 403.
//   last_403_value — the trailing-24h count at the moment X refused. The only
//                    hard observation of the real cap we ever get.
async function persist(): Promise<void> {
  // Deliberately NOT getSupabaseClient(): that returns the service-role client,
  // which bypasses RLS and can read every table in the database. This job needs
  // three things, so it runs on a key scoped to the probe_writer role
  // (migration 082, minted by scripts/mintProbeKey.ts). Falls back to the
  // service key only so the probe keeps working before the scoped key is set.
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PROBE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and a Supabase key are required");
  if (!process.env.SUPABASE_PROBE_KEY) {
    console.warn("[probe] SUPABASE_PROBE_KEY unset — falling back to the service key (over-privileged)");
  }
  const client = createClient(url, key, { auth: { persistSession: false } });

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: submitted24h, error: countErr } = await client
    .from("notes")
    // Ask for submitted_at, not "*": probe_writer is granted select on that one
    // column, and a select over every column is denied outright. The count is
    // the same either way, since a head request returns no rows.
    .select("submitted_at", { count: "exact", head: true })
    .gte("submitted_at", since24h);
  if (countErr) throw countErr;

  const { data: stateRows, error: stateErr } = await client
    .from("pipeline_state")
    .select("key, value")
    .in("key", ["writing_limit", "limit_hit_at", "limit_hit_value"]);
  if (stateErr) throw stateErr;
  const state = new Map((stateRows ?? []).map((r) => [r.key, r.value]));

  const lastHitAt = state.get("limit_hit_at") ?? null;
  const lastHitMs = lastHitAt ? Date.parse(lastHitAt) : NaN;
  const toInt = (v: string | undefined) => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) ? Math.round(n) : null;
  };

  const { error: insertErr } = await client.from("writing_limit_probe_readings").insert({
    nh_5: NH_5,
    nh_10: NH_10,
    hr_r: HR_R,
    hr_100: HR_100,
    hr_14d: HR_14d,
    hr_l: HR_L,
    dn_30: DN_30,
    wl_l: WL_L,
    volume_term: DN_30 * 5,
    predicted_limit: WL,
    branch,
    binding,
    notes_total: sorted.length,
    status_counts: statusCounts,
    submitted_24h: submitted24h ?? null,
    stored_limit: toInt(state.get("writing_limit")),
    last_403_at: lastHitAt,
    last_403_value: toInt(state.get("limit_hit_value")),
    hours_since_last_403: Number.isFinite(lastHitMs)
      ? (Date.now() - lastHitMs) / 3_600_000
      : null,
  });
  if (insertErr) throw insertErr;

  console.log("");
  console.log(`Observed: ${submitted24h ?? "?"} notes submitted in the trailing 24h`);
  console.log(`Stored writing_limit (ratchet guess): ${state.get("writing_limit") ?? "?"}`);
  console.log(
    `Last real 403: ${lastHitAt ?? "never"}` +
      (state.get("limit_hit_value") ? ` at ${state.get("limit_hit_value")} notes` : ""),
  );
  console.log("Reading saved to writing_limit_probe_readings.");
}

// Best-effort. A probe that fails loudly on a DB hiccup becomes a red workflow
// people mute, and a muted probe records nothing at all.
try {
  await persist();
} catch (err) {
  console.warn(`[probe] could not save reading; the printout above still stands: ${(err as Error)?.message}`);
}
