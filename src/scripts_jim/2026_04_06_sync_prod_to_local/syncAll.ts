/**
 * Sync all tables from production Supabase to local Supabase.
 * Read-only on prod. Local tables are cleared and re-populated.
 *
 * Schema-aware: prod merged canonical_note_information into `notes` (May 2026),
 * so notes syncs straight from prod.notes. Skips tables that don't exist locally
 * (e.g. dropped bot_configs, unmatched_scraped_notes, run_snapshots), prod
 * columns that don't exist locally (e.g. dropped current_*_status), and columns
 * too large to fetch in bulk (see SKIP_COLUMNS — pipeline_runs.logs).
 *
 * Usage: bun run src/scripts_jim/2026_04_06_sync_prod_to_local/syncAll.ts
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import "dotenv/config";

const BATCH = 1000;

// (localTable, prodTable) pairs. Local-table-name first; prodTable defaults
// to localTable when omitted. Listed in dependency order — parents first.
type SyncSpec = { local: string; prod?: string };
const SYNC_SPECS: SyncSpec[] = [
  { local: "notewriters" },
  { local: "tweets" }, // prod's tweets table is the author-history source (author_id since migration 033); ~171k rows
  { local: "notes" }, // prod merged canonical_note_information into notes (May 2026)
  { local: "pipeline_runs" },
  { local: "misinfo_monitoring_sightings" }, // after pipeline_runs: processed_run_id FKs to it
  { local: "pipeline_scores" },
  { local: "scraped_notewriter_snapshots" },
  { local: "competing_notes" },
  { local: "public_data_snapshots" },
  { local: "pipeline_state" },
];

const PK: Record<string, string> = {
  pipeline_state: "key",
  tweets: "tweet_id",
  // `id` is GENERATED ALWAYS identity (can't be inserted), so dedupe on the
  // natural key and let local regenerate ids (see DROP_BEFORE_INSERT).
  misinfo_monitoring_sightings: "tweet_id,topic_id",
};

// Columns stripped before insert because the local table generates them
// (GENERATED ALWAYS identity). They're still fetched/ordered on; only dropped
// from the insert payload so Postgres assigns fresh values.
const DROP_BEFORE_INSERT: Record<string, string[]> = {
  misinfo_monitoring_sightings: ["id"],
};

// Columns never fetched from prod: huge JSONB that detoasts on a full-table scan
// and trips prod's statement_timeout. Synced as NULL locally.
// TODO: if a local workflow needs pipeline_runs.logs, backfill it via a separate
// keyset-paginated pass (small batches, projected paths) instead of bulk select.
const SKIP_COLUMNS: Record<string, string[]> = {
  pipeline_runs: ["logs"],
};

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

async function getColumnsForTables(
  conn: string,
  tables: string[],
): Promise<Record<string, Set<string>>> {
  const client = new pg.Client(conn);
  await client.connect();
  const { rows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1)
     ORDER BY table_name, ordinal_position`,
    [tables],
  );
  await client.end();
  const result: Record<string, Set<string>> = {};
  for (const { table_name, column_name } of rows) {
    (result[table_name] ??= new Set()).add(column_name);
  }
  return result;
}

async function fetchAll(
  client: SupabaseClient,
  table: string,
  columns: string[],
  orderCol: string,
): Promise<any[]> {
  // Keyset pagination on orderCol (a unique, sortable cursor — pk/id for every
  // synced table). OFFSET pagination rescans `offset` rows per page, which trips
  // prod's statement_timeout on large tables (e.g. pipeline_scores ~500k rows);
  // a `> cursor` lookup uses the index and stays flat. orderCol must be in the
  // selection to read the cursor — add it if the caller didn't.
  const cols = columns.includes(orderCol) ? columns : [...columns, orderCol];
  const rows: any[] = [];
  let cursor: unknown = null;
  while (true) {
    let query = client
      .from(table)
      .select(cols.join(","))
      .order(orderCol, { ascending: true })
      .limit(BATCH);
    if (cursor !== null) query = query.gt(orderCol, cursor as never);
    const { data, error } = await query;
    if (error) throw new Error(`Fetch ${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < BATCH) break;
    cursor = (data[data.length - 1] as Record<string, unknown>)[orderCol];
  }
  return rows;
}

async function truncateTables(tables: string[]) {
  // TRUNCATE via direct pg, not Supabase REST — REST has a statement timeout
  // that DELETE on 60k pipeline_runs trips. CASCADE skips the dependency
  // ordering work the caller would otherwise have to do.
  if (tables.length === 0) return;
  const client = new pg.Client("postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  await client.connect();
  await client.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await client.end();
}

async function insertAll(
  client: SupabaseClient,
  table: string,
  rows: any[],
  pk: string,
) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await client
      .from(table)
      .upsert(slice, { onConflict: pk, ignoreDuplicates: true });
    if (error) throw new Error(`Insert ${table} at ${i}: ${error.message}`);
  }
}

async function probeProdColumns(t: string): Promise<Set<string> | null> {
  // Supabase's REST API doesn't expose information_schema. Probe by
  // inspecting any one row's keys; if the table is empty we just enumerate
  // a likely-superset by selecting "*" with limit 0 (HEAD on a known column).
  const sample = await prod.from(t).select("*").limit(1);
  if (sample.error) return null;
  if (sample.data?.[0]) return new Set(Object.keys(sample.data[0]));
  // Empty table — fall back to whatever columns we can guess. For our tables,
  // empty in prod = nothing to sync, return empty set so the column-intersect
  // skips it without triggering the "table not present" branch.
  return new Set();
}

async function main() {
  const liveSpecs = SYNC_SPECS.filter((s) => s.prod !== "__skip__");
  const localCols = await getColumnsForTables(
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    liveSpecs.map((s) => s.local),
  );

  // Discover prod columns for each unique source table.
  const prodTables = [...new Set(liveSpecs.map((s) => s.prod ?? s.local))];
  const prodCols: Record<string, Set<string>> = {};
  for (const t of prodTables) {
    const cols = await probeProdColumns(t);
    if (!cols) { console.log(`prod.${t}: not present`); continue; }
    prodCols[t] = cols;
  }

  // Two phases: build the row plan (delete-first-then-insert in dependency
  // order) so FK violations don't bite us mid-sync.
  type Plan = { lt: string; pt: string; pk: string; rows: any[] };
  const plan: Plan[] = [];

  for (const spec of SYNC_SPECS) {
    const lt = spec.local;
    const pt = spec.prod ?? spec.local;
    const pk = PK[lt] ?? "id";

    if (spec.prod === "__skip__") {
      console.log(`${lt}: skipped (local-only — populated by writers/backfills)`);
      continue;
    }
    if (!localCols[lt]) {
      console.log(`${lt}: skipped (not in local schema)`);
      continue;
    }
    if (!prodCols[pt] || prodCols[pt]!.size === 0) {
      console.log(`${lt}: skipped (source prod.${pt} empty or missing)`);
      continue;
    }

    const skipCols = new Set(SKIP_COLUMNS[lt] ?? []);
    const sharedCols = [...localCols[lt]!].filter((c) => prodCols[pt]!.has(c) && !skipCols.has(c));
    if (sharedCols.length === 0) {
      console.log(`${lt}: no shared columns with prod.${pt}; skipping`);
      continue;
    }

    const orderCol = sharedCols.includes(pk) ? pk : sharedCols.includes("id") ? "id" : sharedCols[0]!;
    console.log(`${lt} ← prod.${pt}: fetching ${sharedCols.length} columns`);
    const rows = await fetchAll(prod, pt, sharedCols, orderCol);

    const dropCols = DROP_BEFORE_INSERT[lt];
    if (dropCols) for (const r of rows) for (const c of dropCols) delete (r as any)[c];

    plan.push({ lt, pt, pk, rows });
  }

  // Phase 1: TRUNCATE all tables to be synced (CASCADE handles FK ordering).
  await truncateTables(plan.map((p) => p.lt));
  console.log(`truncated: ${plan.map((p) => p.lt).join(", ")}`);

  // Phase 2: insert in forward dependency order.
  for (const p of plan) {
    if (p.rows.length) await insertAll(local, p.lt, p.rows, p.pk);
    console.log(`${p.lt}: ${p.rows.length} rows inserted`);
  }

  console.log("Done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
