"""Why are we writing fewer notes, concentrated where the deepseek prefilter is on?

Prefilter (PR #171, 2026-06-06) runs a cheap deepseek gate BEFORE the bot and
skips note-writing when it says "no note needed" (outcome=rejected,
outcome_reason=prefilter_no_note). A/B: 80% deepseek-on, 20% off.

This pulls pipeline_runs (last N days) with the cheap columns only and reports,
per day, split by note_prefilter pick (off vs deepseek):
  - total runs
  - "written"  = a note was produced (outcome in candidate/submitted)
  - "submitted"
  - write-rate = written / (total - failed)   <- the headline
  - prefilter_no_note rejections (only meaningful for deepseek-on)
  - other rejection reasons

Goal: find the inflection day, and on the prefilter-on path show whether the
extra rejections are prefilter_no_note (gate got stricter) vs downstream.

Run: uv run src/scripts_jim/2026_06_18_fewer_notes_prefilter/main.py
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

LOOKBACK_DAYS = 21
PREFILTER_START = "2026-06-06"

now = datetime.now(timezone.utc)
window_start = now - timedelta(days=LOOKBACK_DAYS)


def fetch_all_keyset(table, cols, key, extra=None):
    out, last = [], None
    while True:
        q = sb.table(table).select(cols).order(key).limit(1000)
        if last is not None:
            q = q.gt(key, last)
        if extra:
            q = extra(q)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1][key]
        if len(rows) < 1000:
            break
    return out


def day(iso: str) -> str:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).date().isoformat()


def run_extra(q):
    return q.gte("created_at", window_start.isoformat())


print(f"window_start = {window_start.isoformat()}  (last {LOOKBACK_DAYS}d)\n")
print("Fetching pipeline_runs ...")
runs = fetch_all_keyset(
    "pipeline_runs",
    "id, created_at, outcome, outcome_reason, final_stage, ab_test_picks, bot_name",
    "id",
    run_extra,
)
print(f"  -> {len(runs)} runs\n")


def pf_variant(r):
    picks = r.get("ab_test_picks") or {}
    v = picks.get("note_prefilter")
    if v is None:
        return "none(old)"
    return v  # "off" or "deepseek"


WRITTEN = {"candidate", "submitted"}

# --- per day, split by prefilter variant ---
# day -> variant -> Counter of outcomes  + reasons
by_day = defaultdict(lambda: defaultdict(Counter))
reasons_by_day = defaultdict(lambda: defaultdict(Counter))
for r in runs:
    d = day(r["created_at"])
    v = pf_variant(r)
    by_day[d][v][r["outcome"]] += 1
    if r["outcome"] == "rejected":
        reasons_by_day[d][v][r.get("outcome_reason") or "?"] += 1


def write_rate(c):
    total = sum(c.values())
    failed = c.get("failed", 0) + c.get("in_progress", 0)
    denom = total - failed
    written = c.get("candidate", 0) + c.get("submitted", 0)
    return written, denom, (written / denom if denom else float("nan"))


for variant in ("deepseek", "off", "none(old)"):
    print(f"\n================ note_prefilter = {variant} ================")
    print(f"{'day':<12}{'runs':>6}{'writ':>6}{'subm':>6}{'wRate':>8}{'pf_no':>7}{'otherRej':>9}")
    for d in sorted(by_day):
        c = by_day[d].get(variant)
        if not c:
            continue
        written, denom, wr = write_rate(c)
        rj = reasons_by_day[d].get(variant, Counter())
        pf_no = rj.get("prefilter_no_note", 0)
        other_rej = sum(rj.values()) - pf_no
        flag = "  <-- pf" if (variant == "deepseek" and d >= PREFILTER_START) else ""
        print(
            f"{d:<12}{sum(c.values()):>6}{written:>6}{c.get('submitted',0):>6}"
            f"{wr:>7.1%}{pf_no:>7}{other_rej:>9}{flag}"
        )

# --- rejection-reason mix on the prefilter-on path, per day ---
print("\n\n=== prefilter=deepseek rejection-reason mix per day ===")
all_reasons = sorted({rsn for d in reasons_by_day for rsn in reasons_by_day[d].get("deepseek", {})})
print(f"{'day':<12}" + "".join(f"{r[:14]:>16}" for r in all_reasons))
for d in sorted(reasons_by_day):
    rj = reasons_by_day[d].get("deepseek")
    if not rj:
        continue
    print(f"{d:<12}" + "".join(f"{rj.get(r,0):>16}" for r in all_reasons))
