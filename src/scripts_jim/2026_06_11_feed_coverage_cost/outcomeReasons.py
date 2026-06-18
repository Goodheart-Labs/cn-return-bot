"""Breakdown of pipeline_runs by outcome_reason + bot_name over the last 7 days,
to (a) size the prefilter-rejected cheap runs and (b) spot misinfo-prepass rows."""

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


def rest_get(params, range_header):
    url = f"{SUPABASE_URL}/rest/v1/pipeline_runs?{urllib.parse.urlencode(params)}"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
               "Accept": "application/json", "Range": range_header}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
        return json.loads(r.read())


def main():
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    rows, off = [], 0
    while True:
        page = rest_get({"select": "outcome,outcome_reason,bot_name,cost", "created_at": f"gte.{since}",
                         "order": "created_at"}, f"{off}-{off+PAGE_SIZE-1}")
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        off += PAGE_SIZE

    by_reason = defaultdict(lambda: {"n": 0, "cost": 0.0, "priced": 0})
    by_bot = defaultdict(int)
    for r in rows:
        k = (r["outcome"], r["outcome_reason"])
        by_reason[k]["n"] += 1
        by_bot[r["bot_name"] or "none"] += 1
        if r["cost"] is not None:
            by_reason[k]["cost"] += float(r["cost"]); by_reason[k]["priced"] += 1

    print(f"{len(rows)} runs in 7d\n")
    print(f"{'outcome / reason':<42}{'n':>6}{'avg$':>9}")
    for k in sorted(by_reason, key=lambda k: -by_reason[k]["n"]):
        v = by_reason[k]
        avg = v["cost"]/v["priced"] if v["priced"] else 0
        print(f"{str(k[0])+' / '+str(k[1]):<42}{v['n']:>6}{avg:>9.4f}")
    print("\nby bot_name:")
    for b in sorted(by_bot, key=lambda b: -by_bot[b]):
        print(f"  {b:<20}{by_bot[b]:>6}")


if __name__ == "__main__":
    main()
