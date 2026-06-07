"""Quality drill-down for simple-bot.

1) Probe one notes row to learn the columns.
2) Helpful rate of simple-bot submissions by week (current_status).
3) bot_error message clusters for simple-bot, split before/after the 50/50
   split (2026-05-29) to detect any NEW failure introduced by code changes.

Run from repo root:
  uv run src/scripts_jim/2026_06_02_simple_bot_degrade/02_quality.py
"""

import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

SPLIT_DAY = "2026-05-29"

# --- 1) probe notes columns ---
sample = fetch_all("notes", {"select": "*", "limit": "1"})
print("=== notes columns ===")
if sample:
    print(sorted(sample[0].keys()))
print()

# --- 3) bot_error clusters before/after split (do this from pipeline_runs) ---
since = (datetime.now(timezone.utc) - timedelta(days=16)).isoformat()
runs = fetch_all(
    "pipeline_runs",
    {
        "select": "created_at,bot_name,ab_test_picks,outcome,outcome_reason,final_stage,error_message",
        "created_at": f"gte.{since}",
        "outcome": "eq.failed",
        "order": "created_at.asc",
    },
)


def bot_of(r) -> str:
    return (r.get("ab_test_picks") or {}).get("bot") or r.get("bot_name") or "(unknown)"


def normalize(msg):
    if not msg:
        return "(empty)"
    msg = msg.strip().splitlines()[0]
    msg = re.sub(r"https?://\S+", "<URL>", msg)
    msg = re.sub(r"\b[0-9a-f-]{36}\b", "<UUID>", msg)
    msg = re.sub(r"\b\d{6,}\b", "<ID>", msg)
    msg = re.sub(r"\b\d+\b", "<N>", msg)
    return msg[:160]


print("=== simple-bot failed-run final_stage, before vs after split ===")
for label, pred in [("BEFORE " + SPLIT_DAY, lambda d: d < SPLIT_DAY), ("ON/AFTER", lambda d: d >= SPLIT_DAY)]:
    sub = [r for r in runs if bot_of(r) == "simple-bot" and pred(r["created_at"][:10])]
    ndays = len({r["created_at"][:10] for r in sub}) or 1
    print(f"\n-- {label}  ({len(sub)} failed runs over {ndays} days = {len(sub)/ndays:.0f}/day) --")
    print("  final_stage:")
    for s, n in Counter(r.get("final_stage") or "(null)" for r in sub).most_common():
        print(f"    {n:>4}  {s}")
    print("  reason -> top message clusters:")
    by_reason = defaultdict(list)
    for r in sub:
        by_reason[r.get("outcome_reason") or "(null)"].append(r)
    for reason, rs in sorted(by_reason.items(), key=lambda kv: -len(kv[1])):
        print(f"    [{reason}] {len(rs)}")
        for msg, n in Counter(normalize(r.get("error_message")) for r in rs).most_common(5):
            print(f"        {n:>4}  {msg}")
