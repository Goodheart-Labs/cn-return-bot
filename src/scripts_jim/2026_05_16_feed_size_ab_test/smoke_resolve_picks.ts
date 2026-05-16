/**
 * Smoke-check that `resolvePicks` fills in the FEED_SIZE_TEST default on
 * historical pipeline_runs rows. Pulls a few oldest + newest rows from the
 * local Supabase and prints raw vs resolved picks side-by-side.
 *
 *   bun run src/scripts_jim/2026_05_16_feed_size_ab_test/smoke_resolve_picks.ts
 *
 * Pass --prod to hit production.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { resolvePicks } from "../../pipeline/ab-testing/abTests";

const SAMPLE_SIZE = 5;

const useProd = process.argv.includes("--prod");
const url = useProd ? process.env.SUPABASE_URL : process.env.LOCAL_SUPABASE_URL;
const key = useProd ? process.env.SUPABASE_SERVICE_KEY : process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error(`Missing ${useProd ? "" : "LOCAL_"}SUPABASE_URL / SUPABASE_SERVICE_KEY`);
const sb = createClient(url, key);

console.log(`Target: ${useProd ? "PROD" : "LOCAL"}\n`);

type Row = { id: string; created_at: string; ab_test_picks: Record<string, string> | null };

function fmt(row: Row): string {
  const raw = JSON.stringify(row.ab_test_picks);
  const resolved = JSON.stringify(resolvePicks(row.ab_test_picks));
  const changed = raw === resolved ? "(unchanged)" : "(+defaults)";
  return `  ${row.created_at.slice(0, 19)}  ${row.id}\n    raw:      ${raw}\n    resolved: ${resolved}  ${changed}`;
}

const { data: oldest } = await sb
  .from("pipeline_runs")
  .select("id, created_at, ab_test_picks")
  .order("created_at", { ascending: true })
  .limit(SAMPLE_SIZE);

const { data: newest } = await sb
  .from("pipeline_runs")
  .select("id, created_at, ab_test_picks")
  .order("created_at", { ascending: false })
  .limit(SAMPLE_SIZE);

console.log(`Oldest ${SAMPLE_SIZE} rows:`);
for (const r of (oldest as Row[]) ?? []) console.log(fmt(r));
console.log(`\nNewest ${SAMPLE_SIZE} rows:`);
for (const r of (newest as Row[]) ?? []) console.log(fmt(r));
