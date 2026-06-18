"""Actual per-tier split of regular-pipeline runs, from ab_test_picks->>'feed_size'.
Each post is tagged with the feed tier it was sourced from (generateCandidates.ts:190),
so this measures directly how many tweets/day come from small vs large vs xl vs xxl."""

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
PAGE_SIZE = 1000
DAYS = 7


def rest_get(params, range_header):
    url = f"{SUPABASE_URL}/rest/v1/pipeline_runs?{urllib.parse.urlencode(params)}"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
               "Accept": "application/json", "Range": range_header}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
        return json.loads(r.read())


def main():
    since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).isoformat()
    rows, off = [], 0
    while True:
        page = rest_get(
            {"select": "created_at,bot_name,outcome,cost,feed_size:ab_test_picks->>feed_size",
             "created_at": f"gte.{since}", "order": "created_at"},
            f"{off}-{off+PAGE_SIZE-1}")
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        off += PAGE_SIZE

    # regular pipeline = simple-bot (exclude cheap-bot replay/eval rows)
    reg = [r for r in rows if r["bot_name"] == "simple-bot"]
    by_tier = defaultdict(lambda: {"n": 0, "cost": 0.0, "priced": 0})
    for r in reg:
        t = r["feed_size"] or "(none)"
        by_tier[t]["n"] += 1
        if r["cost"] is not None:
            by_tier[t]["cost"] += float(r["cost"]); by_tier[t]["priced"] += 1

    total = len(reg)
    print(f"simple-bot regular runs in {DAYS}d: {total}  (={total/DAYS:.0f}/day)\n")
    print(f"{'tier':<10}{'runs':>7}{'/day':>7}{'% of runs':>11}{'avg$/run':>10}")
    print("-" * 45)
    for t in ["small", "large", "xl", "xxl", "(none)"]:
        if t not in by_tier:
            continue
        v = by_tier[t]
        avg = v["cost"]/v["priced"] if v["priced"] else 0
        print(f"{t:<10}{v['n']:>7}{v['n']/DAYS:>7.0f}{100*v['n']/total:>10.1f}%{avg:>10.4f}")


if __name__ == "__main__":
    main()
