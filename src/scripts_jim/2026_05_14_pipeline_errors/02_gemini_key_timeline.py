"""Check whether the GEMINI_API_KEY error still occurs in recent days."""

from collections import Counter
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()

rows = fetch_all(
    "pipeline_runs",
    {
        "select": "created_at,error_message",
        "outcome": "eq.failed",
        "outcome_reason": "eq.bot_error",
        "error_message": "like.*GEMINI_API_KEY*",
        "created_at": f"gte.{since}",
        "order": "created_at.desc",
    },
)

print(f"GEMINI_API_KEY errors in last 14 days: {len(rows)}")
by_day = Counter(r["created_at"][:10] for r in rows)
for day in sorted(by_day):
    print(f"  {day}  {by_day[day]}")

if rows:
    print(f"\nMost recent: {rows[0]['created_at']}")
    print(f"Oldest in window: {rows[-1]['created_at']}")
