"""Print monthly OpenRouter spend for both API keys with per-model breakdown."""

import json
import os
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

OPENROUTER_MGMT_KEY = os.environ["OPENROUTER_MGMT_KEY"]
KEY_NAMES = ["ai-community-notes-writer-jim", "ai-community-note-writer-2"]


def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://openrouter.ai/api/v1/{path}",
        headers={"Authorization": f"Bearer {OPENROUTER_MGMT_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def top_models(activity: list[dict], since: datetime, n: int = 3) -> list[tuple[str, float]]:
    spend: dict[str, float] = defaultdict(float)
    for row in activity:
        if datetime.fromisoformat(row["date"]).replace(tzinfo=timezone.utc) >= since:
            spend[row["model"]] += row["usage"]
    return sorted(spend.items(), key=lambda x: -x[1])[:n]


def fmt_top(models: list[tuple[str, float]]) -> str:
    if not models:
        return ""
    parts = [f"{m.split('/')[-1]} ${c:.2f}" for m, c in models]
    return f"  ({', '.join(parts)})"


def main():
    keys = api_get("keys")["data"]
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    week_start = datetime.fromtimestamp(
        now.timestamp() - now.weekday() * 86400, tz=timezone.utc
    ).replace(hour=0, minute=0, second=0, microsecond=0)

    all_activity: list[dict] = []
    total = 0.0

    for name in KEY_NAMES:
        match = next((k for k in keys if k["name"] == name), None)
        if not match:
            print(f"{name}: NOT FOUND")
            continue

        activity = api_get(f"activity?api_key_hash={match['hash']}")["data"]
        all_activity.extend(activity)

        monthly = match["usage_monthly"]
        total += monthly
        monthly_top = top_models(activity, month_start)
        weekly_top = top_models(activity, week_start)
        alltime_top = top_models(activity, datetime.min.replace(tzinfo=timezone.utc))

        print(f"{name}:")
        print(f"  Monthly:  ${monthly:.2f}{fmt_top(monthly_top)}")
        print(f"  Weekly:   ${match['usage_weekly']:.2f}{fmt_top(weekly_top)}")
        print(f"  All-time: ${match['usage']:.2f}{fmt_top(alltime_top)}")
        print()

    combined_top = top_models(all_activity, month_start)
    print(f"Combined monthly: ${total:.2f}{fmt_top(combined_top)}")


if __name__ == "__main__":
    main()
