"""Step 1: collect our note IDs with eval score >= 0.

Eligible note = a note we submitted (has an X note_id) whose producing
pipeline_run had evaluation_score >= 0. If a note_id appears on multiple
runs (retries), keep the max eval score.

Writes note_ids.txt (one X noteId per line) for the streaming rating filter.

Run: uv run src/scripts_jim/2026_06_16_ratings_per_day/step1_eligible_notes.py
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


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


print("Fetching submitted pipeline_runs ...")
runs = fetch_all_keyset(
    "pipeline_runs",
    "id, note_id",
    "id",
    lambda q: q.eq("outcome", "submitted"),
)
note_by_run = {r["id"]: r["note_id"] for r in runs if r["note_id"]}
print(f"  -> {len(note_by_run)} runs with a note_id")

# eval score lives in pipeline_scores (score_type='evaluation'), keyed by run id
print("Fetching evaluation scores ...")
run_ids = list(note_by_run)
PAGE = 200
eval_by_run = {}
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
print(f"  -> {len(eval_by_run)} runs have an eval score")

# note_id -> max eval across its runs
eval_by_note = {}
for run_id, ev in eval_by_run.items():
    nid = note_by_run[run_id]
    if nid not in eval_by_note or ev > eval_by_note[nid]:
        eval_by_note[nid] = ev

total_notes = len(eval_by_note)
eligible = sorted(nid for nid, ev in eval_by_note.items() if ev >= 0)
print(f"  -> {total_notes} distinct submitted notes with an eval score")
print(f"  -> {len(eligible)} eligible notes (eval >= 0)")
print(f"  -> {total_notes - len(eligible)} excluded (eval < 0)")

out_path = HERE / "note_ids.txt"
out_path.write_text("\n".join(eligible) + "\n")
print(f"\nWrote {len(eligible)} note IDs -> {out_path}")
