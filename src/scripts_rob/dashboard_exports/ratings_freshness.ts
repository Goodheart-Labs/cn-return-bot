/**
 * One-line freshness report for note_ratings_from_public_dump — the table
 * export_funnel/export_notes read per-note h/sh/nh counts from. It is filled
 * by a SEPARATE job (src/production/fill_ratings.py) that the dashboard
 * refresh ritual does not run, so the refresh script prints this next to the
 * data diff: stale ratings must be visible at the review gate, not silent.
 *
 *   bun run src/scripts_rob/dashboard_exports/ratings_freshness.ts
 */

import { getSupabaseClient } from "../../api/supabaseClient";

const client = getSupabaseClient();

const { count, error: countErr } = await client
  .from("note_ratings_from_public_dump")
  .select("note_id", { count: "exact", head: true });
if (countErr) throw countErr;

const { data, error } = await client
  .from("note_ratings_from_public_dump")
  .select("dump_date, last_synced_at")
  .order("last_synced_at", { ascending: false })
  .limit(1);
if (error) throw error;

const latest = data?.[0];
console.log(
  `[ratings-freshness] note_ratings_from_public_dump: ${count ?? "?"} rows; ` +
  `latest dump_date=${latest?.dump_date ?? "?"} last_synced_at=${latest?.last_synced_at ?? "?"}`,
);
