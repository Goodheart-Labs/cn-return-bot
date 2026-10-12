# /// script
# requires-python = ">=3.11"
# dependencies = ["supabase", "python-dotenv"]
# ///
"""Does the X pipeline produce the same empty candidates? Look at pipeline_runs
since 2026-08-29 whose final note text is empty, by outcome."""
import os
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

rows = []
offset = 0
while True:
    chunk = (sb.table("pipeline_runs")
             .select("id, tweet_id, outcome, outcome_reason, final_stage, created_at, ab_test_picks")
             .gte("created_at", "2026-09-10").lt("created_at", "2026-09-13")
             .eq("logs->note->>text", "")
             .not_.is_("logs->note->>status", "null")
             .range(offset, offset + 999).execute().data)
    rows.extend(chunk)
    if len(chunk) < 1000:
        break
    offset += 1000
print("X runs 2026-09-10..12 with an empty final note text and a note status:", len(rows))
print("by outcome:", Counter(r["outcome"] for r in rows))
print("by final_stage:", Counter(r["final_stage"] for r in rows))
print("by writer arm:", Counter((r["ab_test_picks"] or {}).get("simple_bot_writer") for r in rows))
print("outcome reasons (top):", Counter((r["outcome_reason"] or "")[:60] for r in rows).most_common(8))
cands = [r for r in rows if r["outcome"] in ("candidate", "submitted")]
print("candidates/submitted:", [(r["tweet_id"], r["created_at"][:16]) for r in cands][:10])
