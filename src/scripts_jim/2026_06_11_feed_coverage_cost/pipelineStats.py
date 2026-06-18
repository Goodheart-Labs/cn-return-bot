"""Current regular-pipeline throughput + cost, from pipeline_runs.

Counts runs/day and average cost/run over a recent window, using the `cost`
column (migration 038). Excludes the misinfo pre-pass so we measure the
regular small/large pipeline only.
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
DAYS = 7
PAGE_SIZE = 1000
HTTP_TIMEOUT_S = 120


def rest_get(table, params, range_header=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{urllib.parse.urlencode(params)}"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Accept": "application/json"}
    if range_header:
        headers["Range"] = range_header
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
        return json.loads(r.read())


def fetch_all(table, params):
    out, offset = [], 0
    while True:
        rows = rest_get(table, params, range_header=f"{offset}-{offset + PAGE_SIZE - 1}")
        out.extend(rows)
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return out


def main():
    since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).isoformat()
    rows = fetch_all(
        "pipeline_runs",
        {"select": "created_at,bot_name,outcome,outcome_reason,cost", "created_at": f"gte.{since}", "order": "created_at"},
    )
    print(f"Fetched {len(rows)} pipeline_runs since {since}\n")

    by_day = defaultdict(lambda: {"runs": 0, "cost": 0.0, "priced": 0})
    outcome_counts = defaultdict(int)
    outcome_cost = defaultdict(float)
    outcome_priced = defaultdict(int)
    for r in rows:
        day = r["created_at"][:10]
        c = float(r["cost"]) if r["cost"] is not None else None
        by_day[day]["runs"] += 1
        outcome_counts[r["outcome"] or "none"] += 1
        if c is not None:
            by_day[day]["cost"] += c
            by_day[day]["priced"] += 1
            outcome_cost[r["outcome"] or "none"] += c
            outcome_priced[r["outcome"] or "none"] += 1

    print(f"{'day':<12}{'runs':>7}{'priced':>8}{'cost$':>10}{'avg$/run':>11}")
    print("-" * 48)
    tot_runs = tot_cost = tot_priced = 0
    for day in sorted(by_day):
        d = by_day[day]
        avg = d["cost"] / d["priced"] if d["priced"] else 0
        print(f"{day:<12}{d['runs']:>7}{d['priced']:>8}{d['cost']:>10.2f}{avg:>11.4f}")
        tot_runs += d["runs"]; tot_cost += d["cost"]; tot_priced += d["priced"]
    print("-" * 48)
    avg_all = tot_cost / tot_priced if tot_priced else 0
    print(f"{'TOTAL':<12}{tot_runs:>7}{tot_priced:>8}{tot_cost:>10.2f}{avg_all:>11.4f}")
    print(f"\nruns/day avg: {tot_runs/DAYS:.1f}   priced/day avg: {tot_priced/DAYS:.1f}")
    print(f"overall avg cost/priced run: ${avg_all:.4f}")

    print("\nOutcome breakdown (whole window):")
    print(f"{'outcome':<28}{'count':>8}{'%':>7}{'priced':>8}{'avg$':>9}")
    for oc in sorted(outcome_counts, key=lambda k: -outcome_counts[k]):
        n = outcome_counts[oc]
        pr = outcome_priced[oc]
        avg = outcome_cost[oc] / pr if pr else 0
        print(f"{oc:<28}{n:>8}{100*n/len(rows):>6.1f}%{pr:>8}{avg:>9.4f}")


if __name__ == "__main__":
    main()
