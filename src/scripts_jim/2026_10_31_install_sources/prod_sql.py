"""Runs read-only SQL on the prod database through the Supabase management API.

The database password no longer works from the devbox, so we use the management
API with the token that `supabase login` stores. The endpoint runs the query as
the postgres role, so every query here must only read.
"""

import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

PROJECT_REF = os.environ["SUPABASE_URL"].split("//")[1].split(".")[0]
ACCESS_TOKEN = (Path.home() / ".supabase" / "access-token").read_text().strip()
QUERY_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
# Cloudflare refuses Python's default user agent with error 1010.
USER_AGENT = "curl/8.5.0"
REQUEST_TIMEOUT_SECONDS = 120


def run_sql(sql: str) -> list[dict]:
    response = requests.post(
        QUERY_URL,
        json={"query": sql, "read_only": True},
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}", "User-Agent": USER_AGENT},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    if not response.ok:
        raise RuntimeError(f"{response.status_code}: {response.text}")
    return response.json()


if __name__ == "__main__":
    for row in run_sql(sys.stdin.read()):
        print(row)
