#!/usr/bin/env bash
#
# Start a local Supabase instance and apply migrations.
# Requires: Docker running, npx available.
#
# Usage: bash scripts/local-supabase.sh
#

set -euo pipefail

MIGRATIONS_DIR="migrations"
LOCAL_URL="http://127.0.0.1:54321"
LOCAL_SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
POSTGRES_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker is not running. Start Docker and try again."
  exit 1
fi

# Initialize Supabase project if needed
if [ ! -d "supabase" ]; then
  echo "Initializing Supabase project..."
  npx supabase init
fi

# Start Supabase
echo "Starting local Supabase..."
npx supabase start

# Apply migrations
echo ""
echo "Applying migrations from ${MIGRATIONS_DIR}/..."
for migration in $(ls "${MIGRATIONS_DIR}"/*.sql 2>/dev/null | sort); do
  echo "  Applying: $(basename "$migration")"
  psql "${POSTGRES_URL}" -f "$migration" -q 2>&1 | grep -v "^$" || true
done

echo ""
echo "============================================"
echo "Local Supabase is ready!"
echo ""
echo "Add these to your .env or .env.local:"
echo ""
echo "  LOCAL_SUPABASE_URL=${LOCAL_URL}"
echo "  LOCAL_SUPABASE_SERVICE_KEY=${LOCAL_SERVICE_KEY}"
echo ""
echo "Studio: http://localhost:54323"
echo "============================================"
