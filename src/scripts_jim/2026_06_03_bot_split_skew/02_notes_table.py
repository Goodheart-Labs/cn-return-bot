"""Cross-check: the most recent rows in the `notes` table (by submitted_at),
joined back to pipeline_runs to recover which bot wrote each. This is what the
dashboard/scraper view shows, which is likely where '7 in a row' was observed.
"""

import sys

sys.path.insert(0, "src/scripts_jim/2026_06_02_simple_bot_degrade")
from _supabase import fetch_all  # noqa: E402

# most recent 25 submitted notes by the notes table's own timestamp
notes = fetch_all(
    "notes",
    {
        "select": "note_id,notewriter_id,submitted_at,cn_status",
        "submitted_at": "not.is.null",
        "order": "submitted_at.desc",
        "limit": "25",
    },
)
note_ids = [n["note_id"] for n in notes]

# recover bot via pipeline_runs.note_id (fetch recent submitted runs, build map)
from datetime import datetime, timedelta, timezone  # noqa: E402

since = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
runs = fetch_all(
    "pipeline_runs",
    {
        "select": "note_id,ab_test_picks,bot_name",
        "note_id": "not.is.null",
        "created_at": f"gte.{since}",
    },
)


def bot_of(r) -> str:
    picks = r.get("ab_test_picks") or {}
    return picks.get("bot") or r.get("bot_name") or "(unknown)"


bot_by_note = {r["note_id"]: bot_of(r) for r in runs}

print("=== Most recent 25 notes by notes.submitted_at (newest first) ===")
print("  submitted_at(UTC)    bot          notewriter_id              status")
for n in notes:
    ts = (n.get("submitted_at") or "")[:19].replace("T", " ")
    bot = bot_by_note.get(n["note_id"], "(no run row)")
    print(f"  {ts}  {bot:<11}  {str(n.get('notewriter_id')):<24}  {n.get('cn_status')}")
