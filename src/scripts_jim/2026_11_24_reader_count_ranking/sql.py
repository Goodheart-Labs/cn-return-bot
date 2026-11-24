"""Runs read-only SQL on production through the Supabase management API.

Usage: uv run sql.py <out.json> < query.sql   (writes the rows as JSON)
       uv run sql.py < query.sql              (prints the first rows)
       uv run sql.py --write < migration.sql  (runs it in a writing transaction)
Only aggregate rows leave production: no query here selects reader hashes.
"""

import json
import os
import sys
import urllib.error
import urllib.request

PROJECT_REF = "ugytvkevhsmcpunfvncw"
TIMEOUT_SECONDS = 600


def run_query(sql: str, read_only: bool = True) -> list[dict]:
    token = open(os.path.expanduser("~/.supabase/access-token")).read().strip()
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql, "read_only": read_only}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "curl/8.5.0"},
    )
    try:
        return json.loads(urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS).read())
    except urllib.error.HTTPError as err:
        sys.exit(f"HTTP {err.code}: {err.read().decode()[:3000]}")


if __name__ == "__main__":
    write = "--write" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--write"]
    rows = run_query(sys.stdin.read(), read_only=not write)
    if args:
        json.dump(rows, open(args[0], "w"))
        print(f"{len(rows)} rows -> {args[0]}")
    else:
        print(json.dumps(rows[:40], indent=1, default=str))
