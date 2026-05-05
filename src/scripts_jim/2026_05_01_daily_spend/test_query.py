"""Diagnose why the projected JSONB select times out."""

import os
import time
import urllib.parse
import urllib.request

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def run(label: str, query_string: str, timeout: int = 60):
    url = f"{SUPABASE_URL}/rest/v1/pipeline_runs?{query_string}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Range": "0-99",
    }
    req = urllib.request.Request(url, headers=headers)
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
            print(f"{label}: ok in {time.time() - t:.1f}s, {len(data)} bytes")
    except Exception as e:
        print(f"{label}: FAILED in {time.time() - t:.1f}s — {e}")


# Test 1: select id only, narrow date filter
run(
    "test 1 (id only, single date filter)",
    "select=id&created_at=gte.2026-04-29T00:00:00",
)

# Test 2: select id only, range
run(
    "test 2 (id only, gte+lt)",
    "select=id&created_at=gte.2026-04-29T00:00:00&created_at=lt.2026-04-30T00:00:00",
)

# Test 3: with cost extraction, range
run(
    "test 3 (cost extraction, gte+lt)",
    "select=id,agent_cost:logs->agent->costs->total->>cost&"
    "created_at=gte.2026-04-29T00:00:00&created_at=lt.2026-04-30T00:00:00",
)

# Test 4: full logs, range
run(
    "test 4 (full logs, gte+lt)",
    "select=id,logs&created_at=gte.2026-04-29T00:00:00&created_at=lt.2026-04-30T00:00:00",
)

# Test 5: cost extraction with order
run(
    "test 5 (cost extraction, gte+lt, order)",
    "select=id,agent_cost:logs->agent->costs->total->>cost&"
    "created_at=gte.2026-04-29T00:00:00&created_at=lt.2026-04-30T00:00:00&"
    "order=created_at",
)
