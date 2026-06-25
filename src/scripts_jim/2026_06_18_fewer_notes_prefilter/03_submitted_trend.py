"""Absolute submitted/written notes per day over 6 weeks + writing-cap check.

Tests the premise "we are writing fewer notes since ~the 12th". Reports:
  - written (candidate+submitted) and submitted per day, all paths
  - daily_limit_reached rejections/day (is the X writing cap binding?)
  - pipeline_state writing-cap keys

Run: uv run src/scripts_jim/2026_06_18_fewer_notes_prefilter/03_submitted_trend.py
"""

import os
from collections import defaultdict, Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

LOOKBACK_DAYS = 42
now = datetime.now(timezone.utc)
window_start = now - timedelta(days=LOOKBACK_DAYS)


def day(iso: str) -> str:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).date().isoformat()


out, last = [], None
while True:
    q = (sb.table("pipeline_runs").select("id, created_at, outcome, outcome_reason")
         .gte("created_at", window_start.isoformat()).order("id").limit(1000))
    if last is not None:
        q = q.gt("id", last)
    rows = q.execute().data
    if not rows:
        break
    out.extend(rows)
    last = rows[-1]["id"]
    if len(rows) < 1000:
        break

print(f"runs (last {LOOKBACK_DAYS}d): {len(out)}\n")

per_day = defaultdict(Counter)
for r in out:
    d = day(r["created_at"])
    per_day[d][r["outcome"]] += 1
    if r.get("outcome_reason") == "daily_limit_reached":
        per_day[d]["_cap"] += 1

print(f"{'day':<12}{'runs':>6}{'written':>8}{'submitted':>10}{'capHit':>8}")
for d in sorted(per_day):
    c = per_day[d]
    runs = sum(v for k, v in c.items() if not k.startswith("_"))
    written = c.get("candidate", 0) + c.get("submitted", 0)
    print(f"{d:<12}{runs:>6}{written:>8}{c.get('submitted',0):>10}{c.get('_cap',0):>8}")

print("\n=== pipeline_state (writing cap) ===")
for key in ("writing_limit", "limit_hit_at", "limit_hit_today",
            "days_without_limit_hit", "days_with_limit_hit", "feed_size"):
    res = sb.table("pipeline_state").select("value, updated_at").eq("key", key).execute().data
    if res:
        print(f"  {key:<24} = {res[0].get('value')}   (updated {res[0].get('updated_at')})")
