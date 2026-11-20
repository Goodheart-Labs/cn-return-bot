"""Run one read-only SQL query against prod through Supabase's management API.

The management API is Supabase's own HTTP API for administering a project. Its
`database/query` endpoint runs SQL as the `postgres` role, authenticated with the
token that `supabase login` saved. We use it because the database password is
dead (see the prod-supabase-access memory).

Usage: python3 prod_sql.py < query.sql      (prints JSON rows)
Or import `query(sql)` from another script.
"""
import json
import sys
import urllib.request
from pathlib import Path

PROJECT_REF = "ugytvkevhsmcpunfvncw"
QUERY_TIMEOUT_SECONDS = 600


def query(sql: str) -> list[dict]:
    token = Path.home().joinpath(".supabase/access-token").read_text().strip()
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "curl/8.5.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=QUERY_TIMEOUT_SECONDS) as response:
            return json.loads(response.read() or b"[]")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"SQL failed (HTTP {error.code}): {error.read().decode()[:2000]}") from error


if __name__ == "__main__":
    print(json.dumps(query(sys.stdin.read()), indent=1, default=str))
