"""Inspect raw activity API output to understand why today shows $0."""

import json
import os
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

OPENROUTER_MGMT_KEY = os.environ["OPENROUTER_MGMT_KEY"]


def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://openrouter.ai/api/v1/{path}",
        headers={"Authorization": f"Bearer {OPENROUTER_MGMT_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def main():
    keys = api_get("keys")["data"]
    match = next(k for k in keys if k["name"] == "ai-community-note-writer-2")

    print("KEY METADATA:")
    print(json.dumps(match, indent=2))
    print()

    activity = api_get(f"activity?api_key_hash={match['hash']}")["data"]
    print(f"ACTIVITY ROWS: {len(activity)}")
    print()
    print("LAST 10 ROWS (by date desc):")
    activity_sorted = sorted(activity, key=lambda r: r["date"], reverse=True)
    for row in activity_sorted[:10]:
        print(json.dumps(row, indent=2))
    print()

    print("DAILY TOTALS FROM ACTIVITY (last 14 days):")
    daily: dict[str, float] = defaultdict(float)
    for row in activity:
        daily[row["date"][:10]] += row["usage"]
    for day in sorted(daily.keys(), reverse=True)[:14]:
        print(f"  {day}: ${daily[day]:.4f}")
    print()

    print(f"key.usage_monthly = ${match['usage_monthly']}")
    print(f"key.usage_weekly  = ${match['usage_weekly']}")
    print(f"key.usage         = ${match['usage']}")
    print(f"sum of activity   = ${sum(r['usage'] for r in activity):.4f}")

    now = datetime.now(timezone.utc)
    print(f"\nNow (UTC): {now.isoformat()}")
    print(f"Now (local): {datetime.now().isoformat()}")


if __name__ == "__main__":
    main()
