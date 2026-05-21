"""Pull the full logs/raw responses for recent gpt5-native empty-content failures."""

import json
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

rows = fetch_all(
    "pipeline_runs",
    {
        "select": "id,created_at,tweet_id,ab_test_picks,error_message,logs",
        "outcome": "eq.failed",
        "outcome_reason": "eq.model_output_invalid",
        "created_at": f"gte.{since}",
        "order": "created_at.desc",
    },
)

gpt5 = [r for r in rows if (r.get("ab_test_picks") or {}).get("simple_bot_search") == "gpt5-native"]
empty = [r for r in gpt5 if 'content=""' in (r.get("error_message") or "")]
print(f"gpt5-native model_output_invalid: {len(gpt5)} total, {len(empty)} with empty content")

# Look at logs for a few: did we get any annotations / finish_reason / usage?
for r in empty[:5]:
    print(f"\n=== {r['id']}  {r['created_at']}  tweet={r['tweet_id']} ===")
    logs = r.get("logs") or {}
    # Find the searchDispatch log entries
    bot_logs = logs.get("bot") or {}
    for k, v in logs.items():
        if isinstance(v, dict):
            for kk in v:
                if "search" in kk.lower() or "gpt5" in kk.lower():
                    print(f"  {k}.{kk}: {json.dumps(v[kk])[:600]}")
    # Try to find raw OpenRouter response in any field
    flat = json.dumps(logs)[:50000]
    # Look for finish_reason / refusal markers
    for needle in ["finish_reason", "refusal", "content_filter", "length", "tool_calls", "incomplete"]:
        idx = flat.find(needle)
        if idx >= 0:
            print(f"  [..{needle}..] {flat[max(0,idx-40):idx+120]}")

with open("gpt5_empty.json", "w") as f:
    json.dump(empty[:10], f, indent=2, default=str)
print(f"\nWrote {min(10, len(empty))} samples to gpt5_empty.json")
