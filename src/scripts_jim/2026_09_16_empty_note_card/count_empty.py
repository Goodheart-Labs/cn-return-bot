# /// script
# requires-python = ">=3.11"
# dependencies = ["supabase", "python-dotenv"]
# ///
"""Count published notes whose text is empty or whitespace, and how many
votes they collected. Also lists the notes with no sources for comparison."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

def fetch_all(build):
    rows, page, offset = [], 1000, 0
    while True:
        chunk = build().range(offset, offset + page - 1).execute().data
        rows.extend(chunk)
        if len(chunk) < page:
            return rows
        offset += page

notes = fetch_all(lambda: sb.table("everything_notes").select(
    "id, note, status, author_id, created_at, helpful_count, somewhat_helpful_count, not_helpful_count, "
    "claim:everything_claims(id, status, start_seconds, item:everything_items(url, title, source, project:everything_projects(slug)))"
))
print("notes total:", len(notes))
from collections import Counter
print("by status:", Counter(n["status"] for n in notes))
empty = [n for n in notes if not (n["note"] or "").strip()]
print("empty text:", len(empty), "of which published:", sum(1 for n in empty if n["status"] == "published"))
print("empty by author (None = AI):", Counter(n["author_id"] is None for n in empty))
print("empty with any votes:", sum(1 for n in empty if n["helpful_count"] + n["somewhat_helpful_count"] + n["not_helpful_count"] > 0))
print("empty created range:", min(n["created_at"] for n in empty) if empty else None, "->", max(n["created_at"] for n in empty) if empty else None)
print("empty by day:", sorted(Counter(n["created_at"][:10] for n in empty).items()))
print("empty by project:", Counter((n["claim"] or {}).get("item", {}).get("project", {}).get("slug") for n in empty))
print("empty by source:", Counter((n["claim"] or {}).get("item", {}).get("source") for n in empty))
# How many AI notes were written in the same period, for a rate.
if empty:
    lo = min(n["created_at"] for n in empty)
    same_period = [n for n in notes if n["author_id"] is None and n["created_at"] >= lo]
    print("AI notes since first empty one:", len(same_period))
ids = [n["id"] for n in empty]
votes = fetch_all(lambda: sb.table("everything_votes").select("note_id, vote, voter_id, created_at").in_("note_id", ids)) if ids else []
print("vote rows on empty notes:", len(votes), votes[:10])
Path(__file__).parent.joinpath("data", "empty_notes.json").write_text(json.dumps(empty, indent=1, default=str))
# Short-text tail, in case the writer emitted near-empty notes too.
short = sorted([n for n in notes if n["note"] and len(n["note"].strip()) < 40], key=lambda n: len(n["note"]))
print("notes shorter than 40 chars:", len(short))
for n in short[:15]:
    print(repr(n["note"]), n["status"], n["created_at"][:10])
