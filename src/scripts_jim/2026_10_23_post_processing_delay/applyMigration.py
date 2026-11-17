# /// script
# dependencies = []
# ///
"""Applies one migration file to production through Supabase's management
API, which runs the whole file as one transaction (GOO-549). The second
argument is a query that returns a row when the migration was applied before,
so a migration never runs twice.

    python3 applyMigration.py migrations/133_first_checked_at.sql \
      "select 1 from information_schema.columns where table_name = 'everything_items' and column_name = 'first_checked_at'"
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

migration, applied_before = sys.argv[1], sys.argv[2]
if query(applied_before):
    raise SystemExit(f"{migration} was applied before")
query((REPO / migration).read_text())
# PostgREST, which answers the website's calls, caches the list of functions.
query("notify pgrst, 'reload schema';")
print(f"applied {migration}")
