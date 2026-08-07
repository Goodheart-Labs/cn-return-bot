"""Fetch note ratings (latest public dump) joined to each note's current CN status."""
import json, os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env.local"); load_dotenv(ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

PAGE = 1000


def fetch_all(table: str, columns: str) -> list[dict]:
    rows, offset = [], 0
    while True:
        page = sb.table(table).select(columns).order("note_id").range(offset, offset + PAGE - 1).execute().data
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


ratings = fetch_all("note_ratings_from_public_dump",
                    "note_id, helpful_count, somewhat_helpful_count, not_helpful_count, dump_date")
notes = fetch_all("notes", "note_id, cn_status, submitted_at, first_seen_at, note_text")
print(f"ratings rows: {len(ratings)}  notes: {len(notes)}")

status_by_id = {n["note_id"]: n for n in notes}
joined = [{**r, **{k: status_by_id.get(r["note_id"], {}).get(k) for k in ("cn_status", "submitted_at", "first_seen_at")}}
          for r in ratings]
(HERE / "ratings_status.json").write_text(json.dumps(joined))
print("unmatched:", sum(1 for j in joined if j["cn_status"] is None))
