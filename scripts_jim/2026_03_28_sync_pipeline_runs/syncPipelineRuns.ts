/**
 * Sync pipeline_runs from production Supabase to local Supabase.
 *
 * Usage: bun run scripts_jim/2026_03_28_sync_pipeline_runs/syncPipelineRuns.ts
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;
const TABLE = "pipeline_runs";

function createProductionClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  return createClient(url, key);
}

function createLocalClient(): SupabaseClient {
  const url = process.env.LOCAL_SUPABASE_URL;
  const key = process.env.LOCAL_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing LOCAL_SUPABASE_URL or LOCAL_SUPABASE_SERVICE_KEY");
  return createClient(url, key);
}

async function fetchAllRows(client: SupabaseClient): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

async function main() {
  const prod = createProductionClient();
  const local = createLocalClient();

  console.log("Fetching pipeline_runs from production...");
  const rows = await fetchAllRows(prod);
  console.log(`Fetched ${rows.length} rows from production`);

  if (rows.length === 0) {
    console.log("Nothing to sync");
    return;
  }

  // Upsert in batches
  let inserted = 0;
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batch = rows.slice(i, i + PAGE_SIZE);
    const { error } = await local
      .from(TABLE)
      .upsert(batch, { onConflict: "id" });
    if (error) throw error;
    inserted += batch.length;
    console.log(`Upserted ${inserted}/${rows.length}`);
  }

  console.log("Done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
