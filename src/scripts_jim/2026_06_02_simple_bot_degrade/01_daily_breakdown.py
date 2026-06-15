"""Did simple-bot degrade over the last ~2 weeks?

Pulls pipeline_runs, resolves the bot from ab_test_picks.bot (fallback bot_name),
and prints a per-day, per-bot breakdown of outcome distribution + error rate.
Then drills into simple-bot's daily error-reason mix.

Run from repo root:
  uv run src/scripts_jim/2026_06_02_simple_bot_degrade/01_daily_breakdown.py
"""

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

DAYS = 16
since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).isoformat()

rows = fetch_all(
    "pipeline_runs",
    {
        "select": "id,created_at,bot_name,ab_test_picks,outcome,outcome_reason,final_stage,error_message",
        "created_at": f"gte.{since}",
        "order": "created_at.asc",
    },
)
print(f"Total pipeline_runs in last {DAYS} days: {len(rows)}\n")


def bot_of(r) -> str:
    picks = r.get("ab_test_picks") or {}
    return picks.get("bot") or r.get("bot_name") or "(unknown)"


def day_of(r) -> str:
    return r["created_at"][:10]


# --- distinct outcomes ---
print("=== distinct outcome values ===")
for o, n in Counter(r.get("outcome") or "(null)" for r in rows).most_common():
    print(f"  {n:>6}  {o}")

print("\n=== distinct bots (resolved) ===")
for b, n in Counter(bot_of(r) for r in rows).most_common():
    print(f"  {n:>6}  {b}")

# --- per day, per bot: total + outcome split + error rate ---
# group: day -> bot -> Counter(outcome)
grid: dict[str, dict[str, Counter]] = defaultdict(lambda: defaultdict(Counter))
for r in rows:
    grid[day_of(r)][bot_of(r)][r.get("outcome") or "(null)"] += 1

bots = ["simple-bot", "cheap-bot"]
print("\n=== PER-DAY, PER-BOT outcome breakdown ===")
for day in sorted(grid):
    print(f"\n{day}")
    for bot in bots:
        c = grid[day].get(bot)
        if not c:
            continue
        total = sum(c.values())
        failed = c.get("failed", 0)
        parts = "  ".join(f"{k}={v}" for k, v in c.most_common())
        print(f"  {bot:<11} total={total:<4} fail%={100*failed/total:>5.1f}  | {parts}")

# --- simple-bot only: daily note-written vs other, error reasons ---
print("\n\n=== SIMPLE-BOT daily error-reason mix (outcome=failed) ===")
sb_fail_by_day = defaultdict(Counter)
sb_total_by_day = Counter()
for r in rows:
    if bot_of(r) != "simple-bot":
        continue
    d = day_of(r)
    sb_total_by_day[d] += 1
    if r.get("outcome") == "failed":
        sb_fail_by_day[d][r.get("outcome_reason") or "(null)"] += 1

for day in sorted(sb_total_by_day):
    fails = sb_fail_by_day.get(day, Counter())
    total = sb_total_by_day[day]
    nfail = sum(fails.values())
    reasons = "  ".join(f"{k}={v}" for k, v in fails.most_common())
    print(f"  {day}  total={total:<4} fails={nfail:<3} ({100*nfail/total:>4.1f}%)  {reasons}")
