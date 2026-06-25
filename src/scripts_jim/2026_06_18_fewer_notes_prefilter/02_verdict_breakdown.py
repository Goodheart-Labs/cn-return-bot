"""Split prefilter_no_note rejections into their 3 sub-reasons, per day.

The prefilter says "no note" for one of three reasons (noteNeededPrefilter.ts):
  qw_empty    : query writer returned [] x3  -> "opinion/joke/non-checkable"
  no_evidence : every SearXNG query returned 0 results
  judge_no    : evidence gathered, judge decided no correction needed

If qw_empty or no_evidence spiked on some day, that's a TOOLING regression
(query writer / SearXNG), not a genuine "no note needed" — i.e. silently
writing fewer notes. judge_no spiking = the gate itself got stricter.

Also tracks mean SearXNG resultCount/day as a search-health signal.

Selects only the JSONB sub-paths (not the whole logs blob) to stay light.

Run: uv run src/scripts_jim/2026_06_18_fewer_notes_prefilter/02_verdict_breakdown.py
"""

import os
from collections import defaultdict, Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

LOOKBACK_DAYS = 14
now = datetime.now(timezone.utc)
window_start = now - timedelta(days=LOOKBACK_DAYS)


def day(iso: str) -> str:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).date().isoformat()


def categorize(reasoning: str) -> str:
    r = (reasoning or "").lower()
    if r.startswith("query writer returned no queries"):
        return "qw_empty"
    if r.startswith("no evidence found"):
        return "no_evidence"
    return "judge_no"


# Selecting JSONB sub-paths still detoasts the whole logs blob per row, so the
# full-window scan times out. Sample per-day with a bounded limit instead — the
# proportions (qw_empty / no_evidence / judge_no) are what we need, not exact N.
sel = (
    "id, created_at,"
    "reason:logs->note_prefilter_steps->verdict->>reasoning,"
    "rc:logs->note_prefilter_steps->fetch_and_format_search->resultCount"
)
SAMPLE_PER_DAY = 250

out = []
for d_off in range(LOOKBACK_DAYS + 1):
    d0 = (now - timedelta(days=LOOKBACK_DAYS - d_off)).date()
    d1 = d0 + timedelta(days=1)
    rows = (sb.table("pipeline_runs").select(sel)
            .eq("outcome_reason", "prefilter_no_note")
            .gte("created_at", d0.isoformat())
            .lt("created_at", d1.isoformat())
            .order("created_at").limit(SAMPLE_PER_DAY).execute().data)
    out.extend(rows)
    print(f"  {d0}: sampled {len(rows)}")

print(f"\nprefilter_no_note rows sampled (<= {SAMPLE_PER_DAY}/day): {len(out)}\n")

by_day = defaultdict(Counter)
rc_by_day = defaultdict(list)
for r in out:
    d = day(r["created_at"])
    by_day[d][categorize(r.get("reason"))] += 1
    rc = r.get("rc")
    if rc is not None:
        rc_by_day[d].append(rc)

cats = ["judge_no", "qw_empty", "no_evidence"]
print(f"{'day':<12}{'total':>7}" + "".join(f"{c:>13}" for c in cats) + f"{'meanSearchN':>13}{'zeroN%':>8}")
for d in sorted(by_day):
    c = by_day[d]
    tot = sum(c.values())
    rcs = rc_by_day.get(d, [])
    mean_rc = sum(rcs) / len(rcs) if rcs else float("nan")
    zero = (sum(1 for x in rcs if x == 0) / len(rcs)) if rcs else float("nan")
    line = f"{d:<12}{tot:>7}"
    for cat in cats:
        n = c.get(cat, 0)
        line += f"{n:>8} {n/tot:>3.0%}" if tot else f"{0:>13}"
    line += f"{mean_rc:>13.1f}{zero:>8.0%}"
    print(line)
