"""Scan pipeline_runs with outcome='failed' over the last 7 days.
Bucket by outcome_reason, then by ab_test_picks variant and error_message prefix."""

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

DAYS = 7
since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).isoformat()

rows = fetch_all(
    "pipeline_runs",
    {
        "select": "id,created_at,bot_name,ab_test_picks,outcome,outcome_reason,final_stage,error_message",
        "outcome": "eq.failed",
        "created_at": f"gte.{since}",
        "order": "created_at.desc",
    },
)
print(f"Total failed runs in last {DAYS} days: {len(rows)}\n")

reason_counts = Counter(r.get("outcome_reason") or "(null)" for r in rows)
print("=== By outcome_reason ===")
for reason, n in reason_counts.most_common():
    print(f"  {n:>5}  {reason}")

# Also include total runs in same window for context
all_runs = fetch_all(
    "pipeline_runs",
    {"select": "outcome", "created_at": f"gte.{since}"},
)
total = len(all_runs)
outcome_counts = Counter(r["outcome"] for r in all_runs)
print(f"\n=== All outcomes (total {total}) ===")
for o, n in outcome_counts.most_common():
    print(f"  {n:>5}  {o}  ({100*n/total:.1f}%)")


def normalize(msg: str | None) -> str:
    if not msg:
        return "(empty)"
    msg = msg.strip().splitlines()[0]
    # strip ids/urls/numbers for clustering
    msg = re.sub(r"https?://\S+", "<URL>", msg)
    msg = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", "<UUID>", msg)
    msg = re.sub(r"\b\d{10,}\b", "<ID>", msg)
    msg = re.sub(r"\b\d+\b", "<N>", msg)
    return msg[:200]


print("\n=== Top error_message clusters per reason ===")
by_reason = defaultdict(list)
for r in rows:
    by_reason[r.get("outcome_reason") or "(null)"].append(r)

for reason, rs in sorted(by_reason.items(), key=lambda kv: -len(kv[1])):
    print(f"\n-- {reason} ({len(rs)} runs) --")
    clusters = Counter(normalize(r.get("error_message")) for r in rs)
    for msg, n in clusters.most_common(8):
        print(f"  {n:>4}  {msg}")

print("\n=== Variant breakdown for model_output_invalid / unfetchable_sources / bot_error ===")
for reason in ["model_output_invalid", "unfetchable_sources", "bot_error", "not_completed"]:
    rs = by_reason.get(reason, [])
    if not rs:
        continue
    print(f"\n-- {reason} ({len(rs)}) --")
    variant_keys = ["bot", "simple_bot_search", "simple_bot_writer"]
    for key in variant_keys:
        c = Counter((r.get("ab_test_picks") or {}).get(key) or "(none)" for r in rs)
        if len(c) <= 1:
            continue
        print(f"  by ab_test_picks.{key}:")
        for v, n in c.most_common(10):
            print(f"    {n:>4}  {v}")

with open("failed_runs.json", "w") as f:
    json.dump(rows[:200], f, indent=2, default=str)
print("\nWrote first 200 rows to failed_runs.json")
