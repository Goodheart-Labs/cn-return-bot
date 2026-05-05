"""Daily spend over the last 14 days, computed from pipeline_runs.logs.

Each run's cost is logged under one of {agent, claudeSimple, multiAgent}.costs.total.cost
(plus tool costs already folded into total.cost via aggregateAndLogCosts).

Pulling the full `logs` JSONB column is too slow (large TOASTed JSON); we
project just the three cost paths server-side and chunk by day with a long
HTTP timeout, since the server still has to detoast the column to extract.
"""

import json
import os
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

DAYS = 14
PAGE_SIZE = 100  # small pages — server has to detoast logs JSONB per row
HTTP_TIMEOUT_S = 120
SELECT_FIELDS = (
    "created_at,bot_id,"
    "agent_cost:logs->agent->costs->total->>cost,"
    "simple_cost:logs->claudeSimple->costs->total->>cost,"
    "multi_cost:logs->multiAgent->costs->total->>cost"
)


def rest_get(table: str, params: dict, range_header: str | None = None) -> list[dict]:
    url = f"{SUPABASE_URL}/rest/v1/{table}?{urllib.parse.urlencode(params)}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    }
    if range_header:
        headers["Range"] = range_header
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
        return json.loads(r.read())


def row_cost(row: dict) -> float:
    return sum(
        float(row[k] or 0) for k in ("agent_cost", "simple_cost", "multi_cost")
    )


def fetch_day(day_start_iso: str, day_end_iso: str) -> list[dict]:
    out = []
    offset = 0
    while True:
        rows = rest_get(
            "pipeline_runs",
            {
                "select": SELECT_FIELDS,
                "created_at": f"gte.{day_start_iso}",
                "and": f"(created_at.lt.{day_end_iso})",
                "order": "created_at",
            },
            range_header=f"{offset}-{offset + PAGE_SIZE - 1}",
        )
        out.extend(rows)
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return out


def main():
    today = datetime.now(timezone.utc).date()
    cutoff = today - timedelta(days=DAYS - 1)

    print(f"Fetching pipeline_runs day by day ({cutoff} .. {today}, timeout={HTTP_TIMEOUT_S}s)")

    daily_total: dict[str, float] = defaultdict(float)
    daily_by_bot: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    daily_runs: dict[str, int] = defaultdict(int)
    daily_runs_with_cost: dict[str, int] = defaultdict(int)

    day = cutoff
    while day <= today:
        next_day = day + timedelta(days=1)
        start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc).isoformat()
        end = datetime.combine(next_day, datetime.min.time(), tzinfo=timezone.utc).isoformat()
        rows = fetch_day(start, end)
        day_iso = day.isoformat()
        for row in rows:
            cost = row_cost(row)
            bot = row["bot_id"] or "unknown"
            daily_total[day_iso] += cost
            daily_by_bot[day_iso][bot] += cost
            daily_runs[day_iso] += 1
            if cost > 0:
                daily_runs_with_cost[day_iso] += 1
        print(f"  {day_iso}: {len(rows)} runs, ${daily_total[day_iso]:.2f}")
        day = next_day

    bots = sorted({b for d in daily_by_bot.values() for b in d})

    print(f"\nDaily spend from pipeline_runs.logs (last {DAYS} days, UTC)")
    header = (
        f"{'date':<12} {'total':>9}  {'runs':>5} {'priced':>6}  "
        + "  ".join(f"{b:>20}" for b in bots)
    )
    print(header)
    print("-" * len(header))

    grand_total = 0.0
    grand_runs = 0
    for i in range(DAYS):
        d = (cutoff + timedelta(days=i)).isoformat()
        total = daily_total.get(d, 0.0)
        grand_total += total
        grand_runs += daily_runs.get(d, 0)
        per_bot = "  ".join(f"${daily_by_bot[d].get(b, 0.0):>19.2f}" for b in bots)
        bar = "#" * int(total / 2) if total > 0 else ""
        print(
            f"{d}  ${total:>7.2f}  {daily_runs.get(d, 0):>5} "
            f"{daily_runs_with_cost.get(d, 0):>6}  {per_bot}  {bar}"
        )

    print("-" * len(header))
    print(f"{'TOTAL':<12} ${grand_total:>7.2f}  {grand_runs:>5}")
    print("\n('priced' = runs that day with a non-zero cost recorded in logs)")


if __name__ == "__main__":
    main()
