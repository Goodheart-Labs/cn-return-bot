"""Deep dive on a single gpt5-native empty-content failure to see finish_reason etc."""

import json
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

since = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()

rows = fetch_all(
    "pipeline_runs",
    {
        "select": "id,created_at,ab_test_picks,error_message,logs",
        "outcome": "eq.failed",
        "outcome_reason": "eq.model_output_invalid",
        "created_at": f"gte.{since}",
        "order": "created_at.desc",
    },
)
gpt5_empty = [
    r for r in rows
    if (r.get("ab_test_picks") or {}).get("simple_bot_search") == "gpt5-native"
    and 'content=""' in (r.get("error_message") or "")
]
print(f"Recent gpt5 empty-content failures: {len(gpt5_empty)}")

r = gpt5_empty[0]
print(f"\nLooking at run {r['id']}")
logs = r.get("logs") or {}
print("\nTop-level log keys:", list(logs.keys()))

# Print full simpleBot section
sb = logs.get("simpleBot")
if sb:
    print("\nsimpleBot keys:", list(sb.keys()) if isinstance(sb, dict) else type(sb))
    if isinstance(sb, dict):
        for k, v in sb.items():
            txt = json.dumps(v, indent=2, default=str)
            if len(txt) > 3000:
                txt = txt[:3000] + "...(truncated)"
            print(f"\n--- simpleBot.{k} ---")
            print(txt)

# Also error object
err = logs.get("error")
if err:
    print("\n--- error ---")
    print(json.dumps(err, indent=2, default=str)[:2000])
