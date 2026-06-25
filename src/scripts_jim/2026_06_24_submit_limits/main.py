"""Did we hit X's daily submit limit over the past 14 days?

Three signals:
1. notes.submitted_at  -> notes actually submitted per day
2. pipeline_runs.outcome_reason = 'daily_limit_reached' -> cap blocked a run
3. pipeline_state keys (writing_limit, limit_hit_at, ...) -> current state
"""

import json
import os
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

DAYS = 14
since = datetime.now(timezone.utc) - timedelta(days=DAYS)
since_iso = urllib.parse.quote(since.isoformat())


def get(path: str) -> list:
    """Paginated GET to handle the 1000-row default cap."""
    rows = []
    offset = 0
    page = 1000
    while True:
        url = f"{SUPABASE_URL}/rest/v1/{path}"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + page - 1}",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                batch = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            print(f"ERROR on path: {path}")
            print(e.read().decode())
            raise
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def day(ts: str) -> str:
    return ts[:10]


# 1. Submissions per day
notes = get(
    f"notes?select=note_id,submitted_at&submitted_at=gte.{since_iso}&order=submitted_at.asc"
)
sub_by_day = Counter(day(n["submitted_at"]) for n in notes if n.get("submitted_at"))

# 2. Pipeline runs blocked by the cap
limit_runs = get(
    f"pipeline_runs?select=created_at,tweet_id,outcome_reason&outcome_reason=eq.daily_limit_reached&created_at=gte.{since_iso}&order=created_at.asc"
)
limit_by_day = Counter(day(r["created_at"]) for r in limit_runs)

# Total runs per day for context
all_runs = get(
    f"pipeline_runs?select=created_at&created_at=gte.{since_iso}&order=created_at.asc"
)
runs_by_day = Counter(day(r["created_at"]) for r in all_runs)

# 3. Current pipeline_state
state = get("pipeline_state?select=key,value,updated_at")
state_map = {s["key"]: s for s in state}

print(f"=== Past {DAYS} days (since {since_iso[:10]}) ===\n")

print(f"{'day':<12}{'submitted':>10}{'cap_blocked':>13}{'total_runs':>12}")
all_days = sorted(set(sub_by_day) | set(limit_by_day) | set(runs_by_day))
for d in all_days:
    print(f"{d:<12}{sub_by_day.get(d, 0):>10}{limit_by_day.get(d, 0):>13}{runs_by_day.get(d, 0):>12}")

print(f"\nTotal submitted: {sum(sub_by_day.values())}")
print(f"Total cap-blocked runs (daily_limit_reached): {sum(limit_by_day.values())}")
print(f"Days with >=1 cap-blocked run: {len(limit_by_day)}")

print("\n=== pipeline_state (cap-related) ===")
for k in ["writing_limit", "limit_hit_at", "limit_hit_today",
          "days_with_limit_hit", "days_without_limit_hit"]:
    s = state_map.get(k)
    if s:
        print(f"  {k:<24} = {s['value']!r:<28} (updated {s.get('updated_at','?')})")
    else:
        print(f"  {k:<24} = <not set>")

# 4. Full outcome_reason breakdown over the window (sanity check for other throttle signals)
print("\n=== outcome_reason breakdown (14 days) ===")
runs_full = get(
    f"pipeline_runs?select=outcome_reason&created_at=gte.{since_iso}"
)
oc = Counter(r.get("outcome_reason") or "<null>" for r in runs_full)
for reason, n in oc.most_common():
    print(f"  {reason:<28} {n:>6}")

# 5. Exact timestamps of cap-blocked runs
print("\n=== daily_limit_reached run timestamps ===")
for r in limit_runs:
    print(f"  {r['created_at']}  tweet={r.get('tweet_id')}")
