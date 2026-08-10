/**
 * Backfill pipeline_runs.logs from prod for RECENT runs only — the keyset pass
 * syncAll's SKIP_COLUMNS note promises. Bulk-selecting logs detoasts the whole
 * table and trips prod's statement_timeout, so this fetches small id batches
 * for just the runs the review dashboard's recent cards reference: every
 * review_dashboard_items_v item dated within --days (default 14).
 *
 * Usage: bun run src/scripts_jim/2026_04_06_sync_prod_to_local/backfillRecentLogs.ts [--days 14]
 */

import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import "dotenv/config";

const ID_BATCH = 20; // ~30KB avg per log; keep responses well under prod limits

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key}`);
  return v;
}

const daysArg = process.argv.indexOf("--days");
const days = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 14;

const prod = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"));
const localPg = new pg.Client("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

async function main() {
  await localPg.connect();
  const { rows } = await localPg.query(
    `select distinct pipeline_run_id as id from review_dashboard_items_v
     where pipeline_run_id is not null and item_date >= now() - ($1 || ' days')::interval`,
    [days],
  );
  const ids = rows.map((r) => r.id);
  console.log(`Backfilling logs for ${ids.length} runs (items from the last ${days} days)…`);

  let filled = 0;
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH);
    const { data, error } = await prod
      .from("pipeline_runs")
      .select("id, logs")
      .in("id", batch);
    if (error) throw new Error(`Fetch logs batch at ${i}: ${error.message}`);
    for (const row of data ?? []) {
      if (!row.logs) continue;
      await localPg.query(`update pipeline_runs set logs = $1 where id = $2`, [
        JSON.stringify(row.logs),
        row.id,
      ]);
      filled++;
    }
    if (i % 200 === 0) console.log(`  ${i}/${ids.length} (${filled} filled)`);
  }
  await localPg.end();
  console.log(`Done: ${filled}/${ids.length} runs now carry logs locally.`);
}

main();
