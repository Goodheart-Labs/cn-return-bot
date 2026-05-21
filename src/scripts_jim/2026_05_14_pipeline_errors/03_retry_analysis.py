"""Look at the timeout and UNAVAILABLE failures to see if retries are kicking in
and where in the stack they originate."""

import json
from collections import Counter
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

# Pull failed runs with full logs for the two clusters of interest
rows = fetch_all(
    "pipeline_runs",
    {
        "select": "id,created_at,ab_test_picks,error_message,logs",
        "outcome": "eq.failed",
        "outcome_reason": "eq.bot_error",
        "created_at": f"gte.{since}",
        "order": "created_at.desc",
    },
)

timeouts = [r for r in rows if r.get("error_message") == "The operation timed out."]
unavail = [r for r in rows if "high demand" in (r.get("error_message") or "")]

print(f"timeouts: {len(timeouts)}   unavail: {len(unavail)}\n")

def variant(r):
    return (r.get("ab_test_picks") or {}).get("simple_bot_search") or "(none)"

print("=== timeouts by search variant ===")
for v, n in Counter(variant(r) for r in timeouts).most_common():
    print(f"  {n:>4}  {v}")

print("\n=== unavail by search variant ===")
for v, n in Counter(variant(r) for r in unavail).most_common():
    print(f"  {n:>4}  {v}")

# Inspect a stack from each cluster to see what function threw
def stack(r):
    logs = r.get("logs") or {}
    err = logs.get("error") if isinstance(logs, dict) else None
    if isinstance(err, dict):
        return err.get("stack") or err.get("message") or ""
    return ""

print("\n=== Sample timeout stacks (first 3) ===")
for r in timeouts[:3]:
    s = stack(r)
    print(f"\n[{r['created_at']}] {variant(r)}")
    print(s[:800] if s else "(no stack)")

print("\n=== Sample UNAVAILABLE stacks (first 3) ===")
for r in unavail[:3]:
    s = stack(r)
    print(f"\n[{r['created_at']}] {variant(r)}")
    print(s[:800] if s else "(no stack)")

# Also: did the retry warning get logged before the throw?
print("\n=== Looking for retry warnings in logs of failed runs ===")
def has_retry_warning(r):
    logs = r.get("logs") or {}
    text = json.dumps(logs)[:200000]
    return "Retryable error" in text or "Retrying in" in text

print(f"timeouts with retry-warning in logs: {sum(1 for r in timeouts if has_retry_warning(r))}/{len(timeouts)}")
print(f"unavail with retry-warning in logs:  {sum(1 for r in unavail if has_retry_warning(r))}/{len(unavail)}")
