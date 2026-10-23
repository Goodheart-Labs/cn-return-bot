# /// script
# dependencies = []
# ///
"""Applies one migration file to production through Supabase's management
API, which runs the whole file as one transaction (GOO-549). It refuses when
the column the migration adds already exists, so a migration never runs twice.

    python3 applyMigration.py migrations/133_first_checked_at.sql first_checked_at
"""
import json, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOKEN = Path.home().joinpath(".supabase/access-token").read_text().strip()

def query(sql: str):
    request = urllib.request.Request(
        "https://api.supabase.com/v1/projects/ugytvkevhsmcpunfvncw/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "curl/8.0"},
    )
    return json.load(urllib.request.urlopen(request))

migration, new_column = sys.argv[1], sys.argv[2]
if query(f"select 1 from information_schema.columns where table_name = 'everything_items' and column_name = '{new_column}'"):
    raise SystemExit(f"{new_column} already exists, so {migration} was applied before")
query((REPO / migration).read_text())
print(query("select count(*) filter (where first_checked_at is not null) as with_first_check, count(*) filter (where first_checked_at < processed_at - interval '1 hour') as rechecked_later from everything_items where status = 'done' and checked_scope = 'page'"))
