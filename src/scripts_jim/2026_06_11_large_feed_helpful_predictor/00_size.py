"""
Size the large-feed helpful-vs-NMR dataset before building it.

Window: notes submitted in [now-7d, now-24h], whose submitting pipeline_run
was sourced from the LARGE feed (ab_test_picks->>'feed_size' = 'large'),
with cn_status in (CURRENTLY_RATED_HELPFUL, NEEDS_MORE_RATINGS).

The 24h exclusion is the maturity cutoff: notes younger than ~1 day are
still in flight (most CRH lands within a day), so their label is unsettled.
"""
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

LOOKBACK_DAYS = 7
MATURITY_HOLDOUT_DAYS = 1  # exclude last 24h
PAGE = 1000

now = datetime.now(timezone.utc)
window_start = now - timedelta(days=LOOKBACK_DAYS)
window_end = now - timedelta(days=MATURITY_HOLDOUT_DAYS)
print(f"now            = {now.isoformat()}")
print(f"window_start   = {window_start.isoformat()}  (now - {LOOKBACK_DAYS}d)")
print(f"window_end     = {window_end.isoformat()}  (now - {MATURITY_HOLDOUT_DAYS}d)\n")


def fetch_all_keyset(table, cols, key, extra=None):
    out, last = [], None
    while True:
        q = sb.table(table).select(cols).order(key).limit(PAGE)
        if last is not None:
            q = q.gt(key, last)
        if extra:
            q = extra(q)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1][key]
        if len(rows) < PAGE:
            break
    return out


# 1) Large-feed pipeline_runs that actually produced a submitted note in window.
print("Fetching large-feed pipeline_runs in window ...")
runs = fetch_all_keyset(
    "pipeline_runs",
    "id, note_id, outcome, created_at, feed_size:ab_test_picks->>feed_size",
    "id",
    lambda q: q.eq("ab_test_picks->>feed_size", "large")
    .gte("created_at", window_start.isoformat())
    .lte("created_at", window_end.isoformat()),
)
print(f"  -> {len(runs)} large-feed runs in window")
print("  outcomes:", dict(Counter(r["outcome"] for r in runs)))
large_note_ids = {r["note_id"] for r in runs if r["note_id"]}
print(f"  -> {len(large_note_ids)} have a note_id\n")

# 2) Of those notes, status + submission time.
print("Fetching those notes ...")
note_ids = sorted(large_note_ids)
notes = []
for i in range(0, len(note_ids), 200):
    chunk = note_ids[i : i + 200]
    notes.extend(
        sb.table("notes")
        .select("note_id, cn_status, submitted_at, tweet_id")
        .in_("note_id", chunk)
        .execute()
        .data
    )
print(f"  -> {len(notes)} notes")
print("  cn_status:", dict(Counter(n["cn_status"] for n in notes)))

labelled = [
    n for n in notes
    if n["cn_status"] in ("CURRENTLY_RATED_HELPFUL", "NEEDS_MORE_RATINGS")
    and n["submitted_at"]
]
# Apply the window on submitted_at too (run.created_at ~ submitted_at, but be exact).
in_window = [
    n for n in labelled
    if window_start <= datetime.fromisoformat(n["submitted_at"].replace("Z", "+00:00")) <= window_end
]
pos = sum(1 for n in in_window if n["cn_status"] == "CURRENTLY_RATED_HELPFUL")
print(f"\nLabelled CRH/NMR in window: {len(in_window)}")
if in_window:
    print(f"  CRH (positive): {pos} ({100*pos/len(in_window):.1f}%)")
    print(f"  NMR (negative): {len(in_window)-pos} ({100*(len(in_window)-pos)/len(in_window):.1f}%)")
