"""Votes cast in Common Notes over the last 7 days, read from the vote log.

Read-only. Run from the worktree root:
  uv run --no-project --with supabase --with python-dotenv python src/scripts_jim/2026_11_05_common_notes_votes/votes_last_week.py
"""

import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
WINDOW = timedelta(days=7)
PAGE_SIZE = 1000
NATHAN_USER_ID = "963d0c31-33e5-47da-8aa1-386bc3289efb"


def fetch_casts_since(db, since: datetime) -> list[dict]:
    rows, start = [], 0
    while True:
        page = (db.table("everything_vote_history").select("vote_table, voter_id, at")
                .eq("action", "cast").gte("at", since.isoformat())
                .range(start, start + PAGE_SIZE - 1).execute().data)
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE


def main() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    since = datetime.now(timezone.utc) - WINDOW
    casts = fetch_casts_since(db, since)
    days = WINDOW.total_seconds() / 86400
    voters = Counter(row["voter_id"] for row in casts)
    without_nathan = [row for row in casts if row["voter_id"] != NATHAN_USER_ID]
    print(f"window: since {since:%Y-%m-%d %H:%M} UTC")
    print(f"votes cast: {len(casts)} ({len(casts) / days:.1f} per day) by {len(voters)} voters")
    print("by table:", dict(Counter(row["vote_table"] for row in casts)))
    print(f"without Nathan: {len(without_nathan)} ({len(without_nathan) / days:.1f} per day)")
    print("top voters' shares:", [round(count / len(casts), 3) for _, count in voters.most_common(5)])


if __name__ == "__main__":
    main()
