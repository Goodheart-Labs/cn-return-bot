/**
 * End-to-end test of migrations 027-035 on real prod data.
 *
 * What we're testing:
 *   The plan was always to apply the new migrations on top of the existing
 *   prod schema. The earlier syncAll.ts rewrite cheats by pre-converting prod
 *   data into the new shape during the sync, which doesn't actually exercise
 *   the migration path. This script does it the right way:
 *
 *   1. Reset an isolated schema (`mig_test`) inside local Postgres.
 *   2. Apply migrations 001-026 there → prod-shaped empty schema.
 *   3. Pull a real prod-data sample into `mig_test` using the OLD shape.
 *   4. Apply migrations 027-035 on top → exercises the actual deploy path.
 *   5. Assert the resulting data matches what we expect (notes merged,
 *      bot_name split out, FKs in place, etc.).
 *
 * This proves the migrations work on prod data without touching the
 * `public` schema. Run alongside verify_fresh_db.sh (which proves the
 * migrations apply cleanly to an empty schema).
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_01_merge_canonical_into_notes/verify_migrations_on_prod_data.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const SCHEMA = "mig_test";
const SAMPLE = 200;
const PG_CONN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "migrations");

// Tables we sync from prod (old shape) into the test schema. Order: parents
// first so we can insert without FK violations.
const SYNC_TABLES = [
  { name: "notewriters", limit: SAMPLE },
  { name: "bot_configs", limit: SAMPLE },
  { name: "notes", limit: SAMPLE }, // prod's old notes table
  { name: "canonical_note_information", limit: SAMPLE },
  { name: "pipeline_runs", limit: SAMPLE },
  { name: "scraped_notewriter_snapshots", limit: SAMPLE },
  { name: "competing_notes", limit: SAMPLE },
  { name: "public_data_snapshots", limit: SAMPLE },
  { name: "run_snapshots", limit: SAMPLE },
  { name: "pipeline_state", limit: 50 },
];

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("requires SUPABASE_URL and SUPABASE_SERVICE_KEY (prod creds)");
  process.exit(1);
}
const prod = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const pgClient = new pg.Client(PG_CONN);

function listMigrations(prefixGte: string, prefixLte: string): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => {
      const num = f.slice(0, 3);
      return num >= prefixGte && num <= prefixLte;
    })
    .sort();
}

async function applyMigrations(files: string[]) {
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    process.stdout.write(`  -> ${f}\n`);
    // search_path must be set per-connection so unqualified table names
    // resolve into our isolated schema.
    await pgClient.query(`SET search_path TO ${SCHEMA}, public`);
    await pgClient.query(sql);
  }
}

async function fetchProdSample(table: string, limit: number): Promise<any[]> {
  const { data, error } = await prod.from(table).select("*").limit(limit);
  if (error) {
    console.warn(`  prod.${table}: ${error.message} (skipping)`);
    return [];
  }
  return data ?? [];
}

async function insertIntoTestSchema(table: string, rows: any[]) {
  if (rows.length === 0) return;
  // Restrict to columns the test-schema table actually has (some prod columns
  // may not exist in our recreated schema yet).
  const { rows: colRows } = await pgClient.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [SCHEMA, table],
  );
  const allowed = new Set<string>(colRows.map((r) => r.column_name));
  const cols = Object.keys(rows[0]).filter((c) => allowed.has(c));
  if (cols.length === 0) {
    console.warn(`  no shared columns for ${table}; skipping insert`);
    return;
  }

  // Quote column names defensively
  const colList = cols.map((c) => `"${c}"`).join(", ");
  for (const r of rows) {
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const values = cols.map((c) => r[c]);
    try {
      await pgClient.query(
        `INSERT INTO "${SCHEMA}"."${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values,
      );
    } catch (e: any) {
      // FK violations are expected for some sample data (e.g. competing_notes
      // referencing canonical rows we didn't sample). Log and continue.
      if (!/foreign key|violates/i.test(e.message)) throw e;
    }
  }
}

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

async function assertMigratedShape() {
  // Did the bot_id → bot_name + bot_name_long split happen?
  await pgClient.query(`SET search_path TO ${SCHEMA}, public`);
  const { rows: cols } = await pgClient.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'pipeline_runs'`,
    [SCHEMA],
  );
  const colNames = new Set(cols.map((r) => r.column_name));
  check("pipeline_runs has bot_name", colNames.has("bot_name"));
  check("pipeline_runs has bot_name_long", colNames.has("bot_name_long"));
  check("pipeline_runs has bot_config", colNames.has("bot_config"));
  check("pipeline_runs.bot_id is gone", !colNames.has("bot_id"));
  check("pipeline_runs.tweet_text is gone", !colNames.has("tweet_text"));
  check("pipeline_runs.has_video is gone", !colNames.has("has_video"));

  // Were values backfilled? bot_name should be derivable from bot_name_long
  const { rows: prRows } = await pgClient.query(
    `SELECT bot_name, bot_name_long FROM ${SCHEMA}.pipeline_runs WHERE bot_name_long IS NOT NULL LIMIT 5`,
  );
  for (const r of prRows) {
    const expected = r.bot_name_long.split("_")[0];
    check(`bot_name backfilled correctly (${r.bot_name_long} → ${r.bot_name})`, r.bot_name === expected);
  }

  // Was the canonical → notes merge applied?
  const { rows: tableRows } = await pgClient.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
    [SCHEMA],
  );
  const tables = new Set(tableRows.map((r) => r.table_name));
  check("notes table exists", tables.has("notes"));
  check("canonical_note_information was renamed away", !tables.has("canonical_note_information"));
  check("tweets table created", tables.has("tweets"));
  check("bot_configs is gone", !tables.has("bot_configs"));
  check("unmatched_scraped_notes is gone", !tables.has("unmatched_scraped_notes"));
  check("run_snapshots is gone", !tables.has("run_snapshots"));

  // Did notes get the merged shape?
  const { rows: noteCols } = await pgClient.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'notes'`,
    [SCHEMA],
  );
  const noteCN = new Set(noteCols.map((r) => r.column_name));
  check("notes.notewriter_id present", noteCN.has("notewriter_id"));
  check("notes.somewhat_helpful_count present", noteCN.has("somewhat_helpful_count"));
  check("notes.data_tier present (carried from canonical)", noteCN.has("data_tier"));
  check("notes.current_core_status dropped", !noteCN.has("current_core_status"));
  check("notes.classification dropped", !noteCN.has("classification"));
  check("notes.tweet_text dropped (moved to tweets)", !noteCN.has("tweet_text"));
  check("notes.bot_name dropped (lives on pipeline_runs now)", !noteCN.has("bot_name"));

  // Was the FK installed?
  const { rows: fkRows } = await pgClient.query(
    `SELECT conname FROM pg_constraint c
     JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = $1 AND conname = 'pipeline_runs_note_id_fkey'`,
    [SCHEMA],
  );
  check("pipeline_runs.note_id FK installed (migration 035)", fkRows.length === 1);
}

async function main() {
  await pgClient.connect();
  try {
    console.log("==> Resetting test schema");
    await pgClient.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`);

    console.log("==> Applying old-shape migrations 001-026");
    await applyMigrations(listMigrations("001", "026"));

    console.log("==> Fetching prod sample and inserting into test schema");
    for (const t of SYNC_TABLES) {
      const rows = await fetchProdSample(t.name, t.limit);
      await pgClient.query(`SET search_path TO ${SCHEMA}, public`);
      await insertIntoTestSchema(t.name, rows);
      console.log(`  ${t.name}: ${rows.length} rows fetched`);
    }

    // Pre-migration sanity: do we have data?
    await pgClient.query(`SET search_path TO ${SCHEMA}, public`);
    const { rows: counts } = await pgClient.query(`
      SELECT 'notes' AS t, COUNT(*) FROM ${SCHEMA}.notes
      UNION ALL SELECT 'canonical', COUNT(*) FROM ${SCHEMA}.canonical_note_information
      UNION ALL SELECT 'pipeline_runs', COUNT(*) FROM ${SCHEMA}.pipeline_runs
    `);
    console.log(`==> Pre-migration row counts: ${counts.map((r) => `${r.t}=${r.count}`).join(", ")}`);

    console.log("==> Applying new migrations 027-035");
    await applyMigrations(listMigrations("027", "035"));

    console.log("==> Running assertions");
    await assertMigratedShape();

    console.log(`\n${failures === 0 ? "✓ all checks passed — migrations work end-to-end on prod data" : `✗ ${failures} FAILURE(S)`}`);
  } finally {
    if (failures === 0) {
      await pgClient.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
      console.log("==> Cleaned up test schema");
    } else {
      console.log(`==> Test schema kept at "${SCHEMA}" for inspection (drop manually with: DROP SCHEMA ${SCHEMA} CASCADE)`);
    }
    await pgClient.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try { await pgClient.end(); } catch {}
  process.exit(1);
});
