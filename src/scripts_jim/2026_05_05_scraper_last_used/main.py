"""When was the notewriter scraper last run?

Reads max(scraped_at) from scraped_notewriter_snapshots (one row per note per
scrape) and prints the most recent run plus a histogram of snapshots per day
over the last 14 days.
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

RECENT_DAYS = 14
PAGE_SIZE = 1000


def rest_get(table: str, params: dict, range_header: str | None = None) -> list[dict]:
    url = f"{SUPABASE_URL}/rest/v1/{table}?{urllib.parse.urlencode(params)}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    if range_header is not None:
        headers["Range"] = range_header
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def fetch_all(table: str, params: dict) -> list[dict]:
    out = []
    offset = 0
    while True:
        rows = rest_get(
            table,
            params,
            range_header=f"{offset}-{offset + PAGE_SIZE - 1}",
        )
        if not rows:
            break
        out.extend(rows)
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return out


def main() -> None:
    latest = rest_get(
        "scraped_notewriter_snapshots",
        {
            "select": "scraped_at",
            "order": "scraped_at.desc",
            "limit": "1",
        },
    )
    if not latest:
        print("No snapshots in scraped_notewriter_snapshots.")
        return

    last_scraped = datetime.fromisoformat(latest[0]["scraped_at"].replace("Z", "+00:00"))
    age = datetime.now(timezone.utc) - last_scraped
    hours = age.total_seconds() / 3600
    print(f"Last scrape: {last_scraped.isoformat()}  ({hours:.1f}h ago)")

    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)).isoformat()
    rows = fetch_all(
        "scraped_notewriter_snapshots",
        {
            "select": "scraped_at",
            "scraped_at": f"gte.{cutoff_iso}",
            "order": "scraped_at.desc",
        },
    )

    by_day: Counter[str] = Counter()
    for r in rows:
        ts = datetime.fromisoformat(r["scraped_at"].replace("Z", "+00:00"))
        by_day[ts.date().isoformat()] += 1

    print(f"\nSnapshots per day (last {RECENT_DAYS} days, total {len(rows)}):")
    for day in sorted(by_day, reverse=True):
        bar = "█" * min(60, by_day[day] // 20)
        print(f"  {day}  {by_day[day]:>5}  {bar}")


if __name__ == "__main__":
    main()
