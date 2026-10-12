# /// script
# requires-python = ">=3.11"
# dependencies = ["supabase", "python-dotenv"]
# ///
"""Deletes the 28 published notes with empty text (Jim's go-ahead, 2026-09-16)
and sets their claims to the status the fixed pipeline would have written:
no_note with reason no_correction_needed. Every row is re-checked against the
live database right before deletion; a row that no longer matches is skipped."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
DATA = Path(__file__).parent / "data"

listed = json.loads((DATA / "empty_notes.json").read_text())
ids = [n["id"] for n in listed]
live = sb.table("everything_notes").select("id, note, status, author_id, claim_id, helpful_count, somewhat_helpful_count, not_helpful_count").in_("id", ids).execute().data
votes = sb.table("everything_votes").select("note_id").in_("note_id", ids).execute().data
sources = sb.table("everything_note_sources").select("note_id").in_("note_id", ids).execute().data
voted = {v["note_id"] for v in votes}
sourced = {s["note_id"] for s in sources}

safe, skipped = [], []
for n in live:
    ok = (n["note"] or "").strip() == "" and n["status"] == "published" and n["author_id"] is None \
        and n["id"] not in voted and n["id"] not in sourced \
        and n["helpful_count"] + n["somewhat_helpful_count"] + n["not_helpful_count"] == 0
    (safe if ok else skipped).append(n)
print(f"listed {len(ids)}, found live {len(live)}, safe to delete {len(safe)}, skipped {len(skipped)}")
for n in skipped:
    print("  skipped:", n["id"], repr((n["note"] or "")[:40]), n["status"], n["author_id"], n["id"] in voted)

if safe:
    deleted = sb.table("everything_notes").delete().in_("id", [n["id"] for n in safe]).execute().data
    print("deleted notes:", len(deleted))
    claim_ids = [n["claim_id"] for n in safe]
    updated = (sb.table("everything_claims").update({"status": "no_note", "status_reason": "no_correction_needed"})
               .in_("id", claim_ids).eq("status", "note").execute().data)
    print("claims set to no_note:", len(updated))
    (DATA / "deleted_notes.json").write_text(json.dumps(safe, indent=1))

remaining = sb.table("everything_notes").select("id", count="exact").eq("note", "").execute()
print("published notes with empty text remaining:", remaining.count)
