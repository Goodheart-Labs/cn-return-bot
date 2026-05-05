"""See what error the server actually returns."""

import os
import time
import urllib.error
import urllib.request

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def run(label, qs, timeout=30):
    url = f"{SUPABASE_URL}/rest/v1/pipeline_runs?{qs}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Range": "0-9",
        "Prefer": "count=none",
    }
    req = urllib.request.Request(url, headers=headers)
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            print(f"{label}: ok in {time.time()-t:.2f}s")
    except urllib.error.HTTPError as e:
        print(f"{label}: HTTP {e.code} in {time.time()-t:.2f}s — {e.read().decode()[:300]}")
    except Exception as e:
        print(f"{label}: {type(e).__name__} in {time.time()-t:.2f}s — {e}")


# 1-hour windows
run("1h on 04-29", "select=id&created_at=gte.2026-04-29T12:00:00&created_at=lt.2026-04-29T13:00:00")
run("1h on 05-01", "select=id&created_at=gte.2026-05-01T12:00:00&created_at=lt.2026-05-01T13:00:00")

# Just the most recent rows
run("limit 10 newest", "select=id&order=created_at.desc&limit=10")

# Same with cost extraction
run(
    "limit 10 + cost extraction",
    "select=id,c:logs->claudeSimple->costs->total->>cost&order=created_at.desc&limit=10",
)
