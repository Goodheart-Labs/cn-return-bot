"""Runs one SQL script against prod through the Supabase management API and prints JSON.

  python3 src/scripts_jim/2026_10_31_unneeded_note_examples/sql.py <<'SQL' ... SQL
"""

import json
import sys
import urllib.request
from pathlib import Path

PROJECT_REF = "ugytvkevhsmcpunfvncw"
TOKEN = (Path.home() / ".supabase" / "access-token").read_text().strip()


def run_sql(query: str) -> list[dict]:
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "curl/8.0"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


if __name__ == "__main__":
    print(json.dumps(run_sql(sys.stdin.read()), indent=1, default=str))
