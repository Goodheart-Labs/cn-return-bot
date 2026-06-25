"""Hourly activity for Jun 18, 21, 22 to distinguish self-throttle (gaps) from
error-driven low submissions. Plus a fresh daily_limit_reached count and the
error_message behind Jun 18's submit_error rows."""

import json
import os
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def get(path: str) -> list:
    rows, offset, page = [], 0, 1000
    while True:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/{path}",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                     "Range-Unit": "items", "Range": f"{offset}-{offset + page - 1}"},
            method="GET")
        with urllib.request.urlopen(req, timeout=60) as resp:
            batch = json.loads(resp.read())
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


# Fresh daily_limit_reached count
dlr = get("pipeline_runs?select=created_at&outcome_reason=eq.daily_limit_reached"
          "&created_at=gte.2026-06-10&order=created_at.asc")
print(f"FRESH daily_limit_reached rows since Jun 10: {len(dlr)}")
for r in dlr:
    print(f"  {r['created_at']}")

# Hourly runs + submissions for the target days
for d in ["2026-06-18", "2026-06-21", "2026-06-22"]:
    nxt = d[:8] + f"{int(d[8:]) + 1:02d}"
    runs = get(f"pipeline_runs?select=created_at&created_at=gte.{d}&created_at=lt.{nxt}")
    notes = get(f"notes?select=submitted_at&submitted_at=gte.{d}&submitted_at=lt.{nxt}")
    rh = Counter(r["created_at"][11:13] for r in runs)
    nh = Counter(n["submitted_at"][11:13] for n in notes if n.get("submitted_at"))
    print(f"\n=== {d}  (processed={len(runs)}, submitted={sum(nh.values())}) ===")
    print("hour: " + " ".join(f"{h:02d}" for h in range(24)))
    print("runs: " + " ".join(f"{rh.get(f'{h:02d}',0):>2}"[:2].rjust(2) for h in range(24)))
    print("subs: " + " ".join(f"{nh.get(f'{h:02d}',0):>2}" for h in range(24)))
    print("runs/hr (full): " + " ".join(f"{h:02d}={rh.get(f'{h:02d}',0)}" for h in range(24) if rh.get(f"{h:02d}", 0)))

# Jun 18 submit_error details
print("\n=== Jun 18 submit_error error_messages ===")
se = get("pipeline_runs?select=created_at,outcome,error_message,note_text"
         "&outcome_reason=eq.submit_error&created_at=gte.2026-06-18&created_at=lt.2026-06-19")
for r in se:
    print(f"  {r['created_at']} outcome={r['outcome']} err={r.get('error_message')!r}")
