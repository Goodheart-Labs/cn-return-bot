"""
Cache the two data sources for the writing-limit graph to data.json.

1. submissions  — every notes.submitted_at. This is exactly what X's daily cap
   counts against (see SupabaseLogger.countRecentSubmissions: it counts
   notes rows with submitted_at in the trailing window). The trailing-24h count
   of these is our proxy for "how close to the writing limit are we".

2. limit_hits   — pipeline_runs rows with outcome_reason='daily_limit_reached'.
   These are the candidates a run had to skip because X rejected a submission
   with its daily-limit error (recordDailyLimitHit → submitCandidates marks the
   rest of the queue). Each such run is a moment we ACTUALLY hit the cap.
   outcome_reason is unindexed so a whole-table scan times out; we scan month by
   month (created_at is indexed) and only from when the handling first existed.
"""
import json
import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

HERE = Path(__file__).resolve().parent
OUT = HERE / "data.json"

# daily_limit_reached handling first appears mid-Apr 2026; scan from a bit before.
LIMIT_SCAN_MONTHS = [
    "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01",
    "2026-08-01", "2026-09-01",
]


def fetch_all_submissions():
    rows, offset, page = [], 0, 1000
    while True:
        resp = (sb.table("notes")
                .select("submitted_at")
                .not_.is_("submitted_at", "null")
                .order("submitted_at")
                .range(offset, offset + page - 1).execute())
        rows.extend(resp.data)
        if len(resp.data) < page:
            break
        offset += page
    return [r["submitted_at"] for r in rows if r.get("submitted_at")]


def fetch_limit_hits():
    hits, offset, page = [], 0, 1000
    for start, end in zip(LIMIT_SCAN_MONTHS, LIMIT_SCAN_MONTHS[1:]):
        offset = 0
        while True:
            resp = (sb.table("pipeline_runs")
                    .select("created_at, tweet_id, bot_name")
                    .gte("created_at", start).lt("created_at", end)
                    .eq("outcome_reason", "daily_limit_reached")
                    .order("created_at")
                    .range(offset, offset + page - 1).execute())
            hits.extend(resp.data)
            if len(resp.data) < page:
                break
            offset += page
    return hits


def refresh() -> dict:
    """Fetch both data sources, write data.json, and return the payload."""
    print("Fetching submissions (notes.submitted_at)...")
    submissions = fetch_all_submissions()
    print(f"  {len(submissions)} submissions")

    print("Fetching daily_limit_reached events (pipeline_runs)...")
    limit_hits = fetch_limit_hits()
    print(f"  {len(limit_hits)} skipped-candidate rows")

    data = {"submissions": submissions, "limit_hits": limit_hits}
    OUT.write_text(json.dumps(data))
    print(f"Wrote {OUT}")
    return data


if __name__ == "__main__":
    refresh()
