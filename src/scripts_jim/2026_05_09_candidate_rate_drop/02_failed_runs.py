"""Drill into `outcome='failed'` rows. Group by outcome_reason and by error
fingerprint, and show stack traces (post-refactor) when present.

After the error-handling refactor, every failed row has:
- `error_message` non-NULL (exception message)
- `logs->'error'->>'stack'` populated (top stack frames)
- `outcome_reason` from the documented enum (bot_error, unfetchable_sources,
  model_output_invalid, not_completed, ...)

So this script is the canonical first stop: bucket the failures, then fish
out a representative stack per fingerprint.

Run from repo root:
    uv run src/scripts_jim/2026_05_09_candidate_rate_drop/02_failed_runs.py
"""

import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

LOOKBACK_DAYS = 7
TOP_N_FINGERPRINTS = 20


def fingerprint(msg: str | None) -> str:
    """Strip volatile bits so similar errors group together."""
    if msg is None:
        return "(null)"
    s = re.sub(r"https?://\S+", "<URL>", msg)
    s = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", "<UUID>", s)
    s = re.sub(r"\b\d{15,}\b", "<TWEETID>", s)
    s = re.sub(r"\b\d+\b", "<N>", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:300]


def shorten(msg: str | None, n: int = 240) -> str:
    if msg is None:
        return "(null)"
    s = re.sub(r"\s+", " ", msg).strip()
    return s[:n] + ("…" if len(s) > n else "")


def main() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    rows = fetch_all(
        "pipeline_runs",
        {
            "created_at": f"gte.{cutoff}",
            "outcome": "eq.failed",
            "select": "id,created_at,outcome_reason,bot_name,ab_test_picks,error_message,logs,commit_sha",
            "order": "created_at.desc",
        },
    )
    print(f"`failed` runs in last {LOOKBACK_DAYS} days: {len(rows)}\n")

    # Reason breakdown.
    print("By outcome_reason:")
    for reason, n in Counter(r["outcome_reason"] or "(null)" for r in rows).most_common():
        print(f"  {reason:25s}  {n}")
    print()

    # NULL error_message canary — should be 0 after the refactor.
    null_msg = [r for r in rows if not r["error_message"]]
    if null_msg:
        print(f"⚠ {len(null_msg)} failed rows with NULL error_message (post-refactor invariant violated)")
        for r in null_msg[:3]:
            print(f"    {r['id']}  {r['created_at'][:19]}  reason={r['outcome_reason']}")
        print()

    # Per-axis breakdown (which A/B variant fails most).
    by_axis: dict[str, Counter[str]] = defaultdict(Counter)
    for r in rows:
        for axis, value in (r.get("ab_test_picks") or {}).items():
            by_axis[axis][value] += 1
    if by_axis:
        print("By A/B dimension:")
        for axis, counts in by_axis.items():
            print(f"  {axis}:")
            for value, n in counts.most_common(8):
                print(f"      {value:35s}  {n}")
        print()

    # Top fingerprints with sample stack.
    print(f"=== Top {TOP_N_FINGERPRINTS} error fingerprints (with sample stack frame) ===\n")
    fp_examples: dict[str, dict] = {}
    fp_counter: Counter[str] = Counter()
    for r in rows:
        fp = fingerprint(r["error_message"])
        fp_counter[fp] += 1
        if fp not in fp_examples:
            fp_examples[fp] = r

    for fp, n in fp_counter.most_common(TOP_N_FINGERPRINTS):
        ex = fp_examples[fp]
        picks = ", ".join(f"{k}={v}" for k, v in sorted((ex.get("ab_test_picks") or {}).items()))
        print(f"[{n:4d}]  reason={ex['outcome_reason']:22s}  {fp[:80]}")
        print(f"         e.g. {ex['created_at'][:19]}  {picks}")
        print(f"              msg : {shorten(ex['error_message'], 220)}")
        stack = (ex.get("logs") or {}).get("error", {}).get("stack")
        if stack:
            first = stack.split("\n")[0:3]
            for line in first:
                print(f"              stack: {line.strip()}")
        print()


if __name__ == "__main__":
    main()
