"""
Find missed-opportunity notes caused by the prefilter's query writer returning
no queries.

A missed opportunity = competing_notes row with our_note_id IS NULL,
current_status = CURRENTLY_RATED_HELPFUL, and pipeline_run_id set (the run
where we rejected the tweet). We filter those runs to
outcome_reason = 'prefilter_no_note' whose verdict reasoning is
"query writer returned no queries — ...".

Output: missed_opps.json — one entry per run with tweet_id, competing note
text/status, the query-writer attempt count, and the exact userMessage the
query writer saw (for replay).

Run from workspace root: uv run src/scripts_jim/2026_07_02_query_writer_empty/fetch_missed_opps.py
"""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

OUT = Path(__file__).parent / "missed_opps.json"
PAGE = 1000

def fetch_all(build_query):
    rows = []
    while True:
        page = build_query().range(len(rows), len(rows) + PAGE - 1).execute().data
        rows.extend(page)
        if len(page) < PAGE:
            return rows

missed = fetch_all(
    lambda: db.table("competing_notes")
    .select("tweet_id, note_id, note_text, current_status, pipeline_run_id, created_at_millis")
    .is_("our_note_id", "null")
    .eq("current_status", "CURRENTLY_RATED_HELPFUL")
    .not_.is_("pipeline_run_id", "null")
)
print(f"missed-opportunity competing notes: {len(missed)}")

run_ids = sorted({m["pipeline_run_id"] for m in missed})
runs = []
for i in range(0, len(run_ids), 100):
    chunk = run_ids[i : i + 100]
    runs += (
        db.table("pipeline_runs")
        .select(
            "id, tweet_id, bot_name, outcome_reason, created_at, "
            "verdict:logs->note_prefilter_steps->verdict, "
            "query_writer:logs->note_prefilter_steps->query_writer"
        )
        .in_("id", chunk)
        .eq("outcome_reason", "prefilter_no_note")
        .execute()
        .data
    )
print(f"prefilter_no_note runs among them: {len(runs)}")

no_query_runs = [
    r for r in runs
    if (r.get("verdict") or {}).get("reasoning", "").startswith("query writer returned no queries")
]
print(f"…of which caused by empty query writer: {len(no_query_runs)}")

by_run = {m["pipeline_run_id"]: m for m in missed}
out = []
for r in no_query_runs:
    m = by_run[r["id"]]
    qw = r.get("query_writer") or {}
    out.append({
        "pipeline_run_id": r["id"],
        "tweet_id": r["tweet_id"],
        "run_created_at": r["created_at"],
        "bot_name": r["bot_name"],
        "query_writer_attempts": qw.get("attempts"),
        "user_message": (qw.get("messages") or {}).get("0", {}).get("userMessage"),
        "model": (qw.get("messages") or {}).get("0", {}).get("model"),
        "competing_note_id": m["note_id"],
        "competing_note_text": m["note_text"],
    })

OUT.write_text(json.dumps(out, indent=2))
print(f"wrote {len(out)} cases to {OUT}")
for c in out[:10]:
    preview = (c["user_message"] or "")[:120].replace("\n", " ")
    print(f"- run {c['pipeline_run_id']} tweet {c['tweet_id']} attempts={c['query_writer_attempts']} | {preview}")
