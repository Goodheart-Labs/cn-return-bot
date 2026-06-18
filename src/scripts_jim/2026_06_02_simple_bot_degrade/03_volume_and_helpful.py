"""Total throughput trend + submission-rate trend + helpful-rate sanity.

Run from repo root:
  uv run src/scripts_jim/2026_06_02_simple_bot_degrade/03_volume_and_helpful.py
"""

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

# 1) pipeline_runs columns
sample = fetch_all("pipeline_runs", {"select": "*", "limit": "1"})
print("=== pipeline_runs columns ===")
if sample:
    print(sorted(sample[0].keys()))

since = (datetime.now(timezone.utc) - timedelta(days=16)).isoformat()
rows = fetch_all(
    "pipeline_runs",
    {"select": "created_at,bot_name,ab_test_picks,outcome", "created_at": f"gte.{since}", "order": "created_at.asc"},
)


def bot_of(r):
    return (r.get("ab_test_picks") or {}).get("bot") or r.get("bot_name") or "(unknown)"


print("\n=== TOTAL daily throughput (all bots) + simple-bot submission rate ===")
day_total = Counter()
day_sb_total = Counter()
day_sb_sub = Counter()
for r in rows:
    d = r["created_at"][:10]
    day_total[d] += 1
    if bot_of(r) == "simple-bot":
        day_sb_total[d] += 1
        if r.get("outcome") == "submitted":
            day_sb_sub[d] += 1

print(f"{'day':<12}{'all_runs':>9}{'sb_runs':>9}{'sb_subs':>9}{'sb_sub%':>9}")
for d in sorted(day_total):
    sbt = day_sb_total[d]
    sub = day_sb_sub[d]
    rate = f"{100*sub/sbt:.1f}" if sbt else "-"
    print(f"{d:<12}{day_total[d]:>9}{sbt:>9}{sub:>9}{rate:>9}")

# 2) helpful rate of our notes by submission week (notes table)
notes = fetch_all(
    "notes",
    {"select": "submitted_at,cn_status,view_count", "submitted_at": f"gte.{(datetime.now(timezone.utc)-timedelta(days=60)).isoformat()}", "order": "submitted_at.asc"},
)
print(f"\n=== notes.cn_status distribution (last 60d, n={len(notes)}) ===")
for s, n in Counter(x.get("cn_status") or "(null)" for x in notes).most_common():
    print(f"  {n:>5}  {s}")

print("\n=== helpful rate by submission week (cn_status) ===")
by_week = defaultdict(Counter)
for x in notes:
    sa = x.get("submitted_at")
    if not sa:
        continue
    dt = datetime.fromisoformat(sa.replace("Z", "+00:00"))
    wk = (dt - timedelta(days=dt.weekday())).date().isoformat()
    by_week[wk][x.get("cn_status") or "(null)"] += 1

print(f"{'week':<12}{'n':>5}{'helpful':>9}{'nmr':>7}{'nothelp':>9}{'help%':>8}")
for wk in sorted(by_week):
    c = by_week[wk]
    n = sum(c.values())
    helpful = sum(v for k, v in c.items() if k and "HELPFUL" in k and "NOT" not in k)
    nmr = sum(v for k, v in c.items() if k and "NEEDS" in k)
    nothelp = sum(v for k, v in c.items() if k and "NOT_HELPFUL" in k)
    print(f"{wk:<12}{n:>5}{helpful:>9}{nmr:>7}{nothelp:>9}{100*helpful/n:>7.1f}%")
