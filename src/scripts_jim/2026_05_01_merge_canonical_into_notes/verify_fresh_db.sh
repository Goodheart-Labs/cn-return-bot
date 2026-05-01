#!/usr/bin/env bash
# Verify that all migrations 001-035 apply cleanly to an empty schema in
# the right order. Simulates a fresh developer setup.
#
# Runs against the local supabase Postgres in an isolated schema so it
# doesn't touch anything in `public`.
#
# Usage:
#   bash src/scripts_jim/2026_05_01_merge_canonical_into_notes/verify_fresh_db.sh

set -euo pipefail

PGCONN="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
SCHEMA="migration_test"

echo "==> Resetting test schema"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres <<SQL
DROP SCHEMA IF EXISTS $SCHEMA CASCADE;
CREATE SCHEMA $SCHEMA;
SQL

MIGRATIONS_DIR="$(cd "$(dirname "$0")/../../../migrations" && pwd)"
echo "==> Applying migrations from $MIGRATIONS_DIR"

# Apply each migration with search_path pointed at the isolated schema. The
# migration SQL doesn't qualify table names with a schema so this works.
shopt -s nullglob
for f in "$MIGRATIONS_DIR"/*.sql; do
  name=$(basename "$f")
  echo "  -> $name"
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "SET search_path TO $SCHEMA, public" -f "$f" > /dev/null
done
echo "==> Migrations applied: success"

echo "==> Final table list:"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
SET search_path TO $SCHEMA;
SELECT table_name FROM information_schema.tables
  WHERE table_schema = '$SCHEMA' AND table_type = 'BASE TABLE'
  ORDER BY table_name;
"

echo "==> Foreign keys:"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
SELECT conname, conrelid::regclass AS table, confrelid::regclass AS references
FROM pg_constraint
WHERE contype = 'f' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = '$SCHEMA')
ORDER BY conname;
"

echo "==> Cleaning up test schema"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "DROP SCHEMA $SCHEMA CASCADE" > /dev/null

echo ""
echo "✓ Fresh-DB migration verification passed."
