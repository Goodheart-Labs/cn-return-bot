# /// script
# requires-python = ">=3.11"
# dependencies = ["supabase", "python-dotenv"]
# ///
"""Baseline for the writer call: on Common Notes candidate runs with a real
note text, how many output tokens does the sonnet5 writer produce, and how
does the count relate to the note length?"""
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

rows = (sb.table("everything_pipeline_runs")
        .select("created_at, ab_test_picks, logs->note, logs->costs")
        .eq("kind", "check").eq("outcome", "candidate")
        .gte("created_at", "2026-09-09").lt("created_at", "2026-09-14")
        .neq("logs->note->>text", "")
        .limit(60).execute().data)
print("candidate runs with a note, 2026-09-09..13:", len(rows))
pairs = []
for r in rows:
    arm = (r["ab_test_picks"] or {}).get("simple_bot_writer")
    for e in r["costs"]["entries"]:
        if e["name"] == "note_writer.1":
            pairs.append((arm, e["output_tokens"], len(r["note"]["text"])))
pairs.sort(key=lambda p: p[1])
for p in pairs:
    print("  arm", p[0], "out_tokens", p[1], "note_chars", p[2])
