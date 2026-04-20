/**
 * Sync all tables from production Supabase to local Supabase.
 * Read-only on prod. Local tables are cleared and re-populated.
 *
 * Usage: bun run src/scripts_jim/2026_04_06_sync_prod_to_local/syncAll.ts
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import "dotenv/config";

const BATCH = 1000;

// Dependency order: parents before children
const TABLES = [
  "notewriters",
  "bot_configs",
  "notes",
  "pipeline_runs",
  "pipeline_scores",
  "canonical_note_information",
  "scraped_notewriter_snapshots",
  "competing_notes",
  "public_data_snapshots",
  "run_snapshots",
  "pipeline_state",
  "unmatched_scraped_notes",
];

const PK: Record<string, string> = { pipeline_state: "key" };

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key}`);
  return v;
}

const prod = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"));
const local = createClient(
  env("LOCAL_SUPABASE_URL"),
  env("LOCAL_SUPABASE_SERVICE_KEY")
);

async function getLocalColumns(): Promise<Record<string, string[]>> {
  const client = new pg.Client("postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  await client.connect();
  const { rows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1)
     ORDER BY table_name, ordinal_position`,
    [TABLES]
  );
  await client.end();
  const result: Record<string, string[]> = {};
  for (const { table_name, column_name } of rows) {
    (result[table_name] ??= []).push(column_name);
  }
  return result;
}

async function fetchAll(
  client: SupabaseClient,
  table: string,
  columns: string
): Promise<any[]> {
  const rows: any[] = [];
  const orderCol = PK[table] ?? "id";
  let offset = 0;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .order(orderCol, { ascending: true })
      .range(offset, offset + BATCH - 1);
    if (error) throw new Error(`Fetch ${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < BATCH) break;
    offset += BATCH;
  }
  return rows;
}

async function deleteAll(client: SupabaseClient, table: string) {
  const pk = PK[table] ?? "id";
  const { error } = await client.from(table).delete().not(pk, "is", null);
  if (error) throw new Error(`Delete ${table}: ${error.message}`);
}

async function insertAll(client: SupabaseClient, table: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await client.from(table).insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`Insert ${table} at ${i}: ${error.message}`);
  }
}

async function main() {
  const columnMap = await getLocalColumns();
  console.log("Local schema discovered");

  // Check counts to skip tables already in sync
  const tablesToSync: string[] = [];
  for (const table of TABLES) {
    if (!columnMap[table]) { console.log(`${table}: skipped (not in local)`); continue; }
    const [p, l] = await Promise.all([
      prod.from(table).select("*", { count: "exact", head: true }),
      local.from(table).select("*", { count: "exact", head: true }),
    ]);
    if (p.error || p.count == null) { console.log(`${table}: skipped (not in prod)`); continue; }
    if (p.count === l.count) { console.log(`${table}: ${l.count} rows (in sync)`); continue; }
    console.log(`${table}: prod=${p.count} local=${l.count} → syncing`);
    tablesToSync.push(table);
  }

  if (!tablesToSync.length) { console.log("Everything in sync"); return; }

  // Delete tables that need syncing (reverse dependency order)
  const syncSet = new Set(tablesToSync);
  for (const table of [...TABLES].reverse()) {
    if (!syncSet.has(table)) continue;
    await deleteAll(local, table);
  }

  // Fetch from prod (only local-compatible columns) and insert into local
  for (const table of tablesToSync) {
    const rows = await fetchAll(prod, table, columnMap[table].join(","));
    if (rows.length) await insertAll(local, table, rows);
    console.log(`  ${table}: ${rows.length} rows inserted`);
  }

  console.log("Done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
