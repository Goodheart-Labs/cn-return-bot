"""Print daily OpenRouter spend over the last 14 days across ALL API keys on the account.

Same pattern as daily_spend.py, but enumerates every key from `/keys` instead
of filtering by name. Today's spend is patched from `keys.usage_daily` since
the `activity` endpoint lags.
"""

import json
import os
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

OPENROUTER_MGMT_KEY = os.environ["OPENROUTER_MGMT_KEY"]
DAYS = 14


def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://openrouter.ai/api/v1/{path}",
        headers={"Authorization": f"Bearer {OPENROUTER_MGMT_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def main():
    keys = api_get("keys")["data"]
    today = datetime.now(timezone.utc).date()
    cutoff = today - timedelta(days=DAYS - 1)

    daily_total: dict[str, float] = defaultdict(float)
    per_key_total: dict[str, float] = defaultdict(float)
    earliest_activity_date: datetime.date | None = None

    print(f"Found {len(keys)} key(s) on this account")

    for key in keys:
        name = key["name"] or "(unnamed)"
        activity = api_get(f"activity?api_key_hash={key['hash']}")["data"]
        for row in activity:
            day = datetime.fromisoformat(row["date"]).date()
            if earliest_activity_date is None or day < earliest_activity_date:
                earliest_activity_date = day
            if day < cutoff or day >= today:  # today comes from usage_daily
                continue
            daily_total[day.isoformat()] += row["usage"]
            per_key_total[name] += row["usage"]

        # Today: use real-time usage_daily (activity doesn't include today yet).
        today_iso = today.isoformat()
        daily_total[today_iso] += key["usage_daily"]
        per_key_total[name] += key["usage_daily"]

    if earliest_activity_date and cutoff < earliest_activity_date:
        print(
            f"WARN: activity endpoint only goes back to {earliest_activity_date}; "
            f"days {cutoff} .. {earliest_activity_date - timedelta(days=1)} "
            f"are unavailable and will show $0\n"
        )

    print(f"\nDaily OpenRouter spend (last {DAYS} days, UTC, all keys combined)")
    print(f"{'date':<12} {'total':>10}")
    print("-" * 60)

    grand_total = 0.0
    for i in range(DAYS):
        day = (cutoff + timedelta(days=i)).isoformat()
        total = daily_total.get(day, 0.0)
        grand_total += total
        marker = " (live)" if day == today.isoformat() else ""
        bar = "#" * int(total / 2) if total > 0 else ""
        print(f"{day}  ${total:>8.2f}  {bar}{marker}")

    print("-" * 60)
    print(f"{'TOTAL':<12} ${grand_total:>8.2f}")

    print(f"\nPer-key totals over the last {DAYS} days")
    print(f"{'key':<40} {'total':>10}")
    print("-" * 60)
    for name, total in sorted(per_key_total.items(), key=lambda kv: -kv[1]):
        print(f"{name:<40} ${total:>8.2f}")


if __name__ == "__main__":
    main()
