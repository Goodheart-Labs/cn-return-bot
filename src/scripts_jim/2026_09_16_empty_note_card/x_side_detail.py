# /// script
# requires-python = ">=3.11"
# dependencies = ["supabase", "python-dotenv"]
# ///
"""For X runs whose final note text is empty, look at the logs: did the writer
run and answer empty, what did the verifier say, and what was the note status."""
import os
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

rows = (sb.table("pipeline_runs")
        .select("id, outcome, outcome_reason, final_stage, ab_test_picks, logs")
        .gte("created_at", "2026-09-11").lt("created_at", "2026-09-12")
        .eq("logs->note->>text", "")
        .not_.is_("logs->note->>status", "null")
        .limit(200).execute().data)
print("sample runs:", len(rows))
c = Counter()
for r in rows:
    L = r["logs"]
    arm = (r["ab_test_picks"] or {}).get("simple_bot_writer")
    verifier = (r["ab_test_picks"] or {}).get("simple_bot_verifier")
    nw = L.get("note_writer_steps", {}).get("note_writer")
    writer_ran = nw is not None
    resp = None
    if writer_ran:
        att = nw.get("attempts", {})
        last = att.get(str(len(att) - 1)) or {}
        resp = (last.get("response") or {}).get("note_text")
    sv = L.get("note_writer_steps", {}).get("source_verifier")
    c[(arm, verifier, L["note"].get("status"), r["outcome_reason"], "writer_ran" if writer_ran else "no_writer", "empty_resp" if resp == "" else f"resp={resp is not None}", "verifier_ran" if sv else "no_verifier", L.get("sourceCheck", {}).get("result"))] += 1
for k, v in sorted(c.items(), key=lambda kv: -kv[1]):
    print(v, k)
