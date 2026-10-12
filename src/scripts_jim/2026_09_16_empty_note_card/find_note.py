# /// script
# requires-python = ">=3.11"
# dependencies = ["supabase", "python-dotenv"]
# ///
"""Find the JRE #2551 item and print everything the database holds for the
note whose passage is quoted in Jim's screenshot."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

items = (
    sb.table("everything_items")
    .select("id, project_id, source, url, title, status, checked_scope, priority, published_at, created_at, processed_at, skip_reason")
    .ilike("title", "%Kokotajlo%")
    .execute()
    .data
)
print("ITEMS:")
for it in items:
    print(json.dumps(it, indent=1))

for it in items:
    claims = (
        sb.table("everything_claims")
        .select("id, claim, judgement, status, status_reason, context_quote, start_seconds, end_seconds, created_at, note:everything_notes(*), sources:everything_notes(id, sources:everything_note_sources(url, quote, explanation))")
        .eq("item_id", it["id"])
        .ilike("context_quote", "%remote viewer located a downed Soviet%")
        .execute()
        .data
    )
    print(f"\nMATCHING CLAIMS on {it['url']}: {len(claims)}")
    for c in claims:
        print(json.dumps(c, indent=1, default=str))
