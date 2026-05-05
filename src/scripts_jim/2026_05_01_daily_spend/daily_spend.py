"""Print daily OpenRouter spend over the last 14 days across both API keys.

Note: OpenRouter's `activity` endpoint lags — today's spend is not in it. We
patch today from `keys.usage_daily`, which is real-time. Activity also only
covers a bounded window (typically current + previous calendar month).
"""

import json
import os
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

OPENROUTER_MGMT_KEY = os.environ["OPENROUTER_MGMT_KEY"]
KEY_NAMES = ["ai-community-notes-writer-jim", "ai-community-note-writer-2", "ai-community-notes-writer-jim-2"]
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
    daily_by_key: dict[str, dict[str, float]] = {n: defaultdict(float) for n in KEY_NAMES}
    earliest_activity_date: datetime.date | None = None

    for name in KEY_NAMES:
        match = next((k for k in keys if k["name"] == name), None)
        if not match:
            print(f"{name}: NOT FOUND")
            continue

        activity = api_get(f"activity?api_key_hash={match['hash']}")["data"]
        for row in activity:
            day = datetime.fromisoformat(row["date"]).date()
            if earliest_activity_date is None or day < earliest_activity_date:
                earliest_activity_date = day
            if day < cutoff or day >= today:  # today comes from usage_daily
                continue
            daily_total[day.isoformat()] += row["usage"]
            daily_by_key[name][day.isoformat()] += row["usage"]

        # Today: use real-time usage_daily (activity doesn't include today yet).
        today_iso = today.isoformat()
        daily_total[today_iso] += match["usage_daily"]
        daily_by_key[name][today_iso] += match["usage_daily"]

    if earliest_activity_date and cutoff < earliest_activity_date:
        print(
            f"WARN: activity endpoint only goes back to {earliest_activity_date}; "
            f"days {cutoff} .. {earliest_activity_date - timedelta(days=1)} "
            f"are unavailable and will show $0\n"
        )

    print(f"Daily OpenRouter spend (last {DAYS} days, UTC)")
    print(f"{'date':<12} {'total':>10}  " + "  ".join(f"{n:>32}" for n in KEY_NAMES))
    print("-" * (12 + 12 + 2 + (34 * len(KEY_NAMES))))

    grand_total = 0.0
    for i in range(DAYS):
        day = (cutoff + timedelta(days=i)).isoformat()
        total = daily_total.get(day, 0.0)
        grand_total += total
        per_key = "  ".join(f"${daily_by_key[n].get(day, 0.0):>31.2f}" for n in KEY_NAMES)
        marker = " (live)" if day == today.isoformat() else ""
        bar = "#" * int(total / 2) if total > 0 else ""
        print(f"{day}  ${total:>8.2f}  {per_key}  {bar}{marker}")

    print("-" * (12 + 12 + 2 + (34 * len(KEY_NAMES))))
    print(f"{'TOTAL':<12} ${grand_total:>8.2f}")


if __name__ == "__main__":
    main()
