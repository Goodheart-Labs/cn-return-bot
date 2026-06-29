/**
 * Sync all tables from production Supabase to local Supabase.
 * Read-only on prod. Local tables are cleared and re-populated.
 *
 * Schema-aware: handles the canonical_note_information → notes merge from
 * migration 034 (the source of truth in prod is `canonical_note_information`
 * for the row population, with `notes.notewriter_id`/`submitted_at` overlaid
 * on top). Skips tables that don't exist locally (e.g. dropped bot_configs,
 * unmatched_scraped_notes, run_snapshots) and prod columns that don't exist
 * locally (e.g. dropped current_*_status).
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
  { local: "tweets", prod: "__skip__" },          // tweets is local-only (no prod equivalent)
  { local: "notes", prod: "canonical_note_information" }, // merged: prod canonical has the superset of rows
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
  const rows: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select(columns.join(","))
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

    const sharedCols = [...localCols[lt]!].filter((c) => prodCols[pt]!.has(c));
    if (sharedCols.length === 0) {
      console.log(`${lt}: no shared columns with prod.${pt}; skipping`);
      continue;
    }

    const orderCol = sharedCols.includes(pk) ? pk : sharedCols.includes("id") ? "id" : sharedCols[0]!;
    console.log(`${lt} ← prod.${pt}: fetching ${sharedCols.length} columns`);
    const rows = await fetchAll(prod, pt, sharedCols, orderCol);

    if (lt === "notes" && pt === "canonical_note_information") {
      // Overlay notewriter_id + submitted_at from prod's legacy notes table.
      try {
        const overlay = await fetchAll(prod, "notes", ["note_id", "notewriter_id", "submitted_at"], "note_id");
        const byId = new Map(overlay.map((o: any) => [o.note_id, o]));
        for (const r of rows) {
          const o = byId.get(r.note_id);
          if (o) {
            if (o.notewriter_id != null) r.notewriter_id = o.notewriter_id;
            if (o.submitted_at != null) r.submitted_at = o.submitted_at;
          }
        }
        console.log(`  overlaid notewriter_id/submitted_at on ${overlay.length} notes`);
      } catch (e: any) {
        console.warn(`  overlay from prod.notes failed (non-fatal): ${e.message}`);
      }
    }

    if (lt === "pipeline_runs") {
      // prod's bot_id is the variant-encoded form (renamed to bot_name_long
      // by migration 031). Refetch it explicitly and split into the new
      // bot_name + bot_name_long columns. bot_config stays NULL — it didn't
      // exist on prod.
      try {
        const refetch = await fetchAll(prod, "pipeline_runs", ["id", "bot_id"], "id");
        const byId = new Map(refetch.map((r: any) => [r.id, r.bot_id]));
        for (const r of rows) {
          const botId = byId.get(r.id);
          if (botId) {
            r.bot_name_long = botId;
            r.bot_name = botId.split("_")[0];
          }
        }
        console.log(`  mapped bot_id → bot_name_long/bot_name on ${refetch.length} runs`);
      } catch (e: any) {
        console.warn(`  bot_id mapping failed (non-fatal): ${e.message}`);
      }
    }

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
