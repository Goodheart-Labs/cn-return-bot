"""Daily outcome distribution for the last 14 days, plus rejection-reason
breakdown for the most recent 3 days vs. the prior 3-day baseline.

Use this when the candidate rate has visibly dropped and you want to see
which `outcome` / `outcome_reason` bucket absorbed the lost runs.

Run from repo root:
    uv run src/scripts_jim/2026_05_09_candidate_rate_drop/01_outcome_distribution.py
"""

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

LOOKBACK_DAYS = 14


def main() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    rows = fetch_all(
        "pipeline_runs",
        {
            "created_at": f"gte.{cutoff}",
            "select": "id,created_at,outcome,outcome_reason,final_stage,bot_name",
            "order": "created_at.desc",
        },
    )
    print(f"Total pipeline_runs in last {LOOKBACK_DAYS} days: {len(rows)}\n")

    by_date: dict[str, Counter[str]] = defaultdict(Counter)
    for r in rows:
        by_date[r["created_at"][:10]][r["outcome"] or "(null)"] += 1

    outcomes = ["candidate", "submitted", "rejected", "failed", "filtered", "in_progress", "(null)"]
    header = "date         total  " + "  ".join(f"{o:>11}" for o in outcomes) + "  cand_rate"
    print(header)
    print("-" * len(header))
    for d in sorted(by_date):
        counts = by_date[d]
        total = sum(counts.values())
        cand = counts.get("candidate", 0) + counts.get("submitted", 0)
        rate = cand / total if total else 0
        row = f"{d}  {total:5d}  " + "  ".join(f"{counts.get(o, 0):>11d}" for o in outcomes) + f"  {rate:7.1%}"
        print(row)

    print("\ncand_rate = (candidate + submitted) / total. `submitted` only happens when X API accepted the note.\n")

    print("=" * 90)
    print("REJECTED / FAILED outcome_reason — last 3 days")
    print("=" * 90)
    cutoff_3d = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    recent = [r for r in rows if r["created_at"] >= cutoff_3d and r["outcome"] in ("rejected", "failed")]
    by_reason: Counter[tuple[str, str]] = Counter()
    for r in recent:
        by_reason[(r["outcome"], r["outcome_reason"] or "(null)")] += 1
    for (outcome, reason), n in by_reason.most_common():
        print(f"  {outcome:9s}  {reason:30s}  {n:5d}")

    print()
    print("=" * 90)
    print("Same breakdown, prior 3 days (baseline comparison)")
    print("=" * 90)
    cutoff_6d = (datetime.now(timezone.utc) - timedelta(days=6)).isoformat()
    baseline = [r for r in rows if cutoff_6d <= r["created_at"] < cutoff_3d and r["outcome"] in ("rejected", "failed")]
    by_reason2: Counter[tuple[str, str]] = Counter()
    for r in baseline:
        by_reason2[(r["outcome"], r["outcome_reason"] or "(null)")] += 1
    for (outcome, reason), n in by_reason2.most_common():
        print(f"  {outcome:9s}  {reason:30s}  {n:5d}")


if __name__ == "__main__":
    main()
