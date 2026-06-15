"""Direct coverage check: of the live `small` feed snapshot (dump_small), how many
posts did we actually run the pipeline on (pipeline_runs row) vs. inserted-as-known
but never processed vs. never seen at all?"""

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HERE = os.path.dirname(__file__)


def rest_get(table, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{urllib.parse.urlencode(params)}"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Accept": "application/json"}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
        return json.loads(r.read())


def in_chunks(table, col, select, ids, extra=None):
    found = {}
    for i in range(0, len(ids), 200):
        chunk = ids[i:i + 200]
        params = {"select": select, col: f"in.({','.join(chunk)})"}
        if extra:
            params.update(extra)
        for row in rest_get(table, params):
            found.setdefault(row[col], []).append(row)
    return found


def main():
    fetched = None
    posts = []
    with open(os.path.join(HERE, "dump_small/feed_dump.jsonl")) as f:
        for line in f:
            posts.append(json.loads(line))
    summary = json.load(open(os.path.join(HERE, "dump_small/feed_dump.summary.json")))
    fetched = datetime.fromisoformat(summary["fetchedAt"].replace("Z", "+00:00"))
    ids = [p["id"] for p in posts]
    print(f"live small feed snapshot: {len(ids)} posts (fetched {summary['fetchedAt']})\n")

    runs = in_chunks("pipeline_runs", "tweet_id", "tweet_id,outcome,feed_size:ab_test_picks->>feed_size", ids)
    known = in_chunks("tweets", "tweet_id", "tweet_id", ids)

    ran = set(runs)
    in_tweets = set(known)
    seen_not_run = in_tweets - ran
    never_seen = set(ids) - in_tweets - ran

    n = len(ids)
    print(f"ran pipeline on:        {len(ran):>4} ({100*len(ran)/n:.0f}%)")
    print(f"in tweets, never ran:   {len(seen_not_run):>4} ({100*len(seen_not_run)/n:.0f}%)  <- inserted-as-known but skipped")
    print(f"never seen at all:      {len(never_seen):>4} ({100*len(never_seen)/n:.0f}%)")

    # of the ran ones, which tier did we tag them?
    tier = {}
    for tid, rs in runs.items():
        t = rs[0]["feed_size"] or "(none)"
        tier[t] = tier.get(t, 0) + 1
    print("\nof the ran ones, tier tagged:", tier)

    # coverage restricted to posts old enough to have had a fair chance (>6h, <48h)
    def age_h(p):
        return (fetched - datetime.fromisoformat(p["created_at"].replace("Z", "+00:00"))).total_seconds() / 3600
    fair = [p for p in posts if 6 < age_h(p) < 48]
    fair_ids = [p["id"] for p in fair]
    fair_ran = sum(1 for i in fair_ids if i in ran)
    fair_seen = sum(1 for i in fair_ids if i in in_tweets or i in ran)
    print(f"\nfair window (6-48h old): {len(fair)} posts")
    print(f"  ran:  {fair_ran} ({100*fair_ran/len(fair):.0f}%)")
    print(f"  seen: {fair_seen} ({100*fair_seen/len(fair):.0f}%)  (ran or inserted-as-known)")


if __name__ == "__main__":
    main()
