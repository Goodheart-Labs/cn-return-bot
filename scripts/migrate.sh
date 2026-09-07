#!/usr/bin/env bash
# Apply one SQL migration to prod: scripts/migrate.sh migrations/085_ranking_decisions.sql
# Needs SUPABASE_DB_PASSWORD in .env (dashboard → Project Settings → Database).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && source .env && set +a
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is not set}"
PSQL=$(command -v psql || echo /opt/homebrew/opt/libpq/bin/psql)
PGPASSWORD="$SUPABASE_DB_PASSWORD" PGCONNECT_TIMEOUT=15 "$PSQL" \
  -h aws-1-eu-west-1.pooler.supabase.com -p 5432 -U postgres.ugytvkevhsmcpunfvncw -d postgres \
  -v ON_ERROR_STOP=1 --single-transaction -f "$1"
