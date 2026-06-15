"""Test selecting nested JSONB subpaths to slim the funnel fetch."""
import os, json
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).resolve().parents[3] / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

sel = (
    "id, outcome, check_reasoning,"
    "logs->note_writer_steps->satire_detector->skipped,"
    "logs->note_writer_steps->skipReason,"
    "logs->note_writer_steps->note_writer->attempts->0->charCount,"
    "logs->note_writer_steps->note_needed_judge->messages->1->content->note_needed"
)
rows = (
    sb.table("pipeline_runs").select(sel)
    .eq("bot_name", "cheap-bot").order("created_at", desc=True).limit(3).execute()
).data
for r in rows:
    print(json.dumps(r, default=str)[:400])
    print("---")
