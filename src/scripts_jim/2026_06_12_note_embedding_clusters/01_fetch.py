"""Fetch simple-bot notes (sonnet search + gemini writer) with eval score and CN status."""

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

OUT_DIR = Path(__file__).parent
PAGE_SIZE = 1000

SEARCH_VARIANT = "sonnet46-native"
WRITER_VARIANT = "gemini-flash"


def fetch_all_keyset(table, cols, key, extra=None):
    out, last = [], None
    while True:
        q = sb.table(table).select(cols).order(key).limit(PAGE_SIZE)
        if last is not None:
            q = q.gt(key, last)
        if extra:
            q = extra(q)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1][key]
        if len(rows) < PAGE_SIZE:
            break
    return out


runs = fetch_all_keyset(
    "pipeline_runs",
    "id, tweet_id, note_id, note_text, outcome, created_at",
    "id",
    extra=lambda q: q.eq("bot_name", "simple-bot")
    .eq("ab_test_picks->>simple_bot_search", SEARCH_VARIANT)
    .eq("ab_test_picks->>simple_bot_writer", WRITER_VARIANT)
    .not_.is_("note_text", "null"),
)
runs = [r for r in runs if r["note_text"].strip()]
print(f"runs with non-blank note_text: {len(runs)}")

CHUNK = 200
eval_by_run_id = {}
run_ids = [r["id"] for r in runs]
for i in range(0, len(run_ids), CHUNK):
    rows = (
        sb.table("pipeline_scores")
        .select("pipeline_run_id, score_value")
        .eq("score_type", "evaluation")
        .in_("pipeline_run_id", run_ids[i : i + CHUNK])
        .execute()
        .data
    )
    for row in rows:
        eval_by_run_id[row["pipeline_run_id"]] = row["score_value"]

for r in runs:
    r["evaluation_score"] = eval_by_run_id.get(r["id"])
runs = [r for r in runs if r["evaluation_score"] is not None]
print(f"runs with eval score: {len(runs)}")

note_ids = [r["note_id"] for r in runs if r["note_id"]]
status_by_note_id = {}
for i in range(0, len(note_ids), CHUNK):
    chunk = note_ids[i : i + CHUNK]
    rows = sb.table("notes").select("note_id, cn_status, submitted_at").in_("note_id", chunk).execute().data
    for row in rows:
        status_by_note_id[row["note_id"]] = row

for r in runs:
    note = status_by_note_id.get(r["note_id"]) if r["note_id"] else None
    r["cn_status"] = note["cn_status"] if note else None
    r["submitted"] = bool(note and note["submitted_at"])

submitted = [r for r in runs if r["submitted"]]
print(f"submitted: {len(submitted)}")
status_counts = {}
for r in submitted:
    status_counts[r["cn_status"]] = status_counts.get(r["cn_status"], 0) + 1
print(f"status counts (submitted): {status_counts}")

(OUT_DIR / "notes.json").write_text(json.dumps(runs, indent=1))
print(f"wrote {OUT_DIR / 'notes.json'}")
