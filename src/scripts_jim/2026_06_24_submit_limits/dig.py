"""Follow-ups:
1. Do daily_limit_reached rows actually EXIST in pipeline_runs for today? (fresh)
2. Why so few submissions on June 18 and June 22? Per-day outcome breakdown.
"""

import json
import os
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

since = datetime.now(timezone.utc) - timedelta(days=14)
since_iso = urllib.parse.quote(since.isoformat())


def get(path: str) -> list:
    rows, offset, page = [], 0, 1000
    while True:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/{path}",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + page - 1}",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            batch = json.loads(resp.read())
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


# 1. Fresh: every daily_limit_reached row today
print("=== daily_limit_reached rows in pipeline_runs (last 14d) ===")
dlr = get(
    f"pipeline_runs?select=created_at,tweet_id,final_stage,outcome_reason"
    f"&outcome_reason=eq.daily_limit_reached&created_at=gte.{since_iso}&order=created_at.asc"
)
for r in dlr:
    print(f"  {r['created_at']}  stage={r.get('final_stage')}  tweet={r.get('tweet_id')}")
print(f"  TOTAL rows: {len(dlr)}")

# also submit_error rows (the OTHER way a cap could surface)
print("\n=== submit_error rows (last 14d) ===")
se = get(
    f"pipeline_runs?select=created_at,tweet_id,outcome_reason"
    f"&outcome_reason=eq.submit_error&created_at=gte.{since_iso}&order=created_at.asc"
)
for r in se:
    print(f"  {r['created_at']}  tweet={r.get('tweet_id')}")
print(f"  TOTAL: {len(se)}")

# 2. Per-day outcome breakdown
runs = get(f"pipeline_runs?select=created_at,outcome_reason&created_at=gte.{since_iso}")
per_day = defaultdict(Counter)
for r in runs:
    per_day[r["created_at"][:10]][r.get("outcome_reason") or "<null>"] += 1

reasons = sorted({rr for d in per_day.values() for rr in d})
print("\n=== outcome_reason by day ===")
hdr = "day".ljust(11) + "".join(rr[:13].rjust(14) for rr in reasons) + "total".rjust(8)
print(hdr)
for d in sorted(per_day):
    row = per_day[d]
    line = d.ljust(11) + "".join(str(row.get(rr, 0)).rjust(14) for rr in reasons)
    line += str(sum(row.values())).rjust(8)
    print(line)

# 3. Submitted-note rate per day + did the bot run all day? (distinct hours seen)
notes = get(
    f"notes?select=submitted_at&submitted_at=gte.{since_iso}&order=submitted_at.asc"
)
sub_by_day = Counter(n["submitted_at"][:10] for n in notes if n.get("submitted_at"))
hours_by_day = defaultdict(set)
for r in runs:
    hours_by_day[r["created_at"][:10]].add(r["created_at"][11:13])

print("\n=== submission rate + activity coverage ===")
print(f"{'day':<11}{'submitted':>10}{'processed':>11}{'rate%':>8}{'active_hrs':>12}")
for d in sorted(per_day):
    proc = sum(per_day[d].values())
    sub = sub_by_day.get(d, 0)
    rate = 100 * sub / proc if proc else 0
    print(f"{d:<11}{sub:>10}{proc:>11}{rate:>7.1f}{len(hours_by_day[d]):>12}")
