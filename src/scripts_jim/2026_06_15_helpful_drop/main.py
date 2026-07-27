"""Why did helpful-note count drop in the last few days?

Context: PR #180 (merged 2026-06-13) added an eval-score submission-threshold
A/B test. 50% of runs keep threshold 0 (baseline); 50% relax it to -0.5..-2.5,
which lets lower-quality notes through. User expected MORE notes (more helpful
AND more unhelpful), but observed helpful DROPPED. Hypothesis: a binding daily
writing cap means relaxed-threshold notes DISPLACE high-quality ones.

This script pulls submitted notes (last N days), joins pipeline_runs for the
eval_submit_threshold variant + evaluation_score, and reports:
  1. Per-day submission volume, helpful count, helpful rate, mean eval score.
     (Volume flat after 06-13 => cap binding. Mean eval dropping = lag-free
      proof the submitted MIX got worse.)
  2. Breakdown by eval_submit_threshold variant since the test started.
  3. writing_limit / limit_hit pipeline_state.

Maturity caveat: most CRH lands within ~1 day of submission, so cohorts from
the last ~24h are still in flight (expect artificially low helpful counts).

Run: uv run src/scripts_jim/2026_06_15_helpful_drop/main.py
"""

import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

LOOKBACK_DAYS = 24
TEST_START = "2026-06-13"  # PR #180 merge date
HELPFUL = "CURRENTLY_RATED_HELPFUL"
NH = "CURRENTLY_RATED_NOT_HELPFUL"
NMR = "NEEDS_MORE_RATINGS"

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


# --- 1) submitted pipeline_runs in window: note_id, eval score, threshold variant
def run_extra(q):
    return q.eq("outcome", "submitted").gte("created_at", window_start.isoformat())


print(f"window_start = {window_start.isoformat()}  (last {LOOKBACK_DAYS}d)\n")
print("Fetching submitted pipeline_runs ...")
runs = fetch_all_keyset(
    "pipeline_runs",
    "id, note_id, created_at, ab_test_picks, bot_name",
    "id",
    run_extra,
)
print(f"  -> {len(runs)} submitted runs")

# note_id -> run (one submission per note)
run_by_note = {r["note_id"]: r for r in runs if r["note_id"]}
note_ids = sorted(run_by_note)

# eval score lives in pipeline_scores (score_type='evaluation'), keyed by run id
print("Fetching evaluation scores ...")
run_ids = [r["id"] for r in runs]
eval_by_run = {}
PAGE = 200
for i in range(0, len(run_ids), PAGE):
    for s in (
        sb.table("pipeline_scores")
        .select("pipeline_run_id, score_value")
        .eq("score_type", "evaluation")
        .in_("pipeline_run_id", run_ids[i : i + PAGE])
        .execute()
        .data
    ):
        try:
            eval_by_run[s["pipeline_run_id"]] = float(s["score_value"])
        except (TypeError, ValueError):
            pass

# --- 2) notes -> cn_status, submitted_at
print("Fetching notes ...")
notes = {}
for i in range(0, len(note_ids), PAGE):
    for n in (
        sb.table("notes")
        .select("note_id, cn_status, submitted_at")
        .in_("note_id", note_ids[i : i + PAGE])
        .execute()
        .data
    ):
        notes[n["note_id"]] = n

# --- join
rows = []
for nid, r in run_by_note.items():
    n = notes.get(nid)
    if not n or not n.get("submitted_at"):
        continue
    picks = r.get("ab_test_picks") or {}
    rows.append(
        {
            "day": day(n["submitted_at"]),
            "submitted_at": n["submitted_at"],
            "cn_status": n["cn_status"],
            "eval": eval_by_run.get(r["id"]),
            "threshold": picks.get("eval_submit_threshold", "0(default)"),
            "bot": r.get("bot_name"),
        }
    )

print(f"  -> {len(rows)} joined submitted notes\n")


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else float("nan")


# --- per-day table
print("=== PER SUBMISSION-DAY ===")
print(f"{'day':<12}{'subs':>6}{'help':>6}{'NMR':>6}{'NH':>6}{'help%':>8}{'meanEval':>10}{'%eval<0':>9}")
by_day = defaultdict(list)
for r in rows:
    by_day[r["day"]].append(r)
for d in sorted(by_day):
    rs = by_day[d]
    h = sum(r["cn_status"] == HELPFUL for r in rs)
    nmr = sum(r["cn_status"] == NMR for r in rs)
    nh = sum(r["cn_status"] == NH for r in rs)
    evals = [r["eval"] for r in rs if r["eval"] is not None]
    neg = sum(1 for e in evals if e < 0)
    flag = "  <-- test" if d >= TEST_START else ""
    print(
        f"{d:<12}{len(rs):>6}{h:>6}{nmr:>6}{nh:>6}{h/len(rs):>7.1%}"
        f"{mean(evals):>10.2f}{(neg/len(evals) if evals else 0):>8.1%}{flag}"
    )

# --- by threshold variant, since test start
print("\n=== BY eval_submit_threshold VARIANT (submitted on/after test start) ===")
print(f"{'threshold':<14}{'subs':>6}{'help':>6}{'NMR':>6}{'NH':>6}{'help%':>8}{'meanEval':>10}")
by_var = defaultdict(list)
for r in rows:
    if r["day"] >= TEST_START:
        by_var[str(r["threshold"])].append(r)
for v in sorted(by_var, key=lambda x: (x != "0", x)):
    rs = by_var[v]
    h = sum(r["cn_status"] == HELPFUL for r in rs)
    nmr = sum(r["cn_status"] == NMR for r in rs)
    nh = sum(r["cn_status"] == NH for r in rs)
    print(
        f"{v:<14}{len(rs):>6}{h:>6}{nmr:>6}{nh:>6}{h/len(rs):>7.1%}"
        f"{mean([r['eval'] for r in rs]):>10.2f}"
    )

# --- writing limit state
print("\n=== pipeline_state (writing cap) ===")
for key in ("writing_limit", "limit_hit_at", "limit_hit_today",
            "days_without_limit_hit", "days_with_limit_hit"):
    res = sb.table("pipeline_state").select("value, updated_at").eq("key", key).execute().data
    if res:
        print(f"  {key:<24} = {res[0].get('value')}   (updated {res[0].get('updated_at')})")
