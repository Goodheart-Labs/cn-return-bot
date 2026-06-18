"""Why are the last ~7 *submitted* notes all cheap-bot if bot split is 50/50?

The 50/50 AB split picks ONE bot per pipeline run (Math.random). A run only
produces a submitted note if it gets past scoring/eval. So "last 7 notes" =
last 7 *submissions*, not last 7 runs. Hypothesis: simple-bot is still being
picked ~50% of runs, but its runs rarely end in a submission right now.

This prints:
  1. The last N runs in time order with their picked bot + outcome (the raw tape).
  2. Per-bot: how many runs, how many submitted, submission rate (last X days).
  3. The last N *submitted* notes in time order with their bot.

Run from repo root:
  uv run src/scripts_jim/2026_06_03_bot_split_skew/01_recent_sequence.py
"""

import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "src/scripts_jim/2026_06_02_simple_bot_degrade")
from _supabase import fetch_all  # noqa: E402

DAYS = 4
LAST_RUNS_SHOWN = 40
since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).isoformat()

rows = fetch_all(
    "pipeline_runs",
    {
        "select": "id,created_at,bot_name,ab_test_picks,outcome,outcome_reason,final_stage,note_id",
        "created_at": f"gte.{since}",
        "order": "created_at.asc",
    },
)
print(f"Total pipeline_runs in last {DAYS} days: {len(rows)}\n")


def bot_of(r) -> str:
    picks = r.get("ab_test_picks") or {}
    return picks.get("bot") or r.get("bot_name") or "(unknown)"


# --- 1. raw tape of the last N runs ---
print(f"=== LAST {LAST_RUNS_SHOWN} RUNS (time order) ===")
print("  time(UTC)         bot          outcome            reason / stage")
for r in rows[-LAST_RUNS_SHOWN:]:
    bot = bot_of(r)
    submitted = "  <== NOTE" if r.get("note_id") else ""
    ts = r["created_at"][5:19].replace("T", " ")
    reason = r.get("outcome_reason") or r.get("final_stage") or ""
    print(f"  {ts}  {bot:<11}  {(r.get('outcome') or '(null)'):<16}  {reason}{submitted}")

# --- 2. per-bot submission rate ---
print(f"\n=== PER-BOT submission rate (last {DAYS} days) ===")
runs_by_bot = Counter(bot_of(r) for r in rows)
subs_by_bot = Counter(bot_of(r) for r in rows if r.get("note_id"))
for bot in sorted(runs_by_bot, key=lambda b: -runs_by_bot[b]):
    n = runs_by_bot[bot]
    s = subs_by_bot.get(bot, 0)
    print(f"  {bot:<11} runs={n:<4} submitted={s:<4} sub%={100*s/n:>5.1f}")

# --- outcome split per bot (where do simple-bot runs die?) ---
print(f"\n=== OUTCOME split per bot (last {DAYS} days) ===")
split: dict[str, Counter] = defaultdict(Counter)
for r in rows:
    split[bot_of(r)][r.get("outcome") or "(null)"] += 1
for bot in sorted(split, key=lambda b: -runs_by_bot[b]):
    parts = "  ".join(f"{k}={v}" for k, v in split[bot].most_common())
    print(f"  {bot:<11} {parts}")

# --- where simple-bot runs die (outcome_reason for non-submitted) ---
print(f"\n=== simple-bot non-submission reasons (last {DAYS} days) ===")
sb_reasons = Counter(
    f"{r.get('outcome')}/{r.get('outcome_reason') or r.get('final_stage')}"
    for r in rows
    if bot_of(r) == "simple-bot" and not r.get("note_id")
)
for k, v in sb_reasons.most_common():
    print(f"  {v:>4}  {k}")

# --- 3. last N submitted notes in time order with bot ---
print("\n=== LAST 12 SUBMITTED NOTES (runs with note_id, time order) ===")
submitted_runs = [r for r in rows if r.get("note_id")]
for r in submitted_runs[-12:]:
    ts = r["created_at"][5:19].replace("T", " ")
    print(f"  {ts}  {bot_of(r):<11}  note={r['note_id']}")
