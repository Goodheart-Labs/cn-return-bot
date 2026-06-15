"""Find our note + cited sources for a given tweet_id (read only)."""
import os
import json
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

TWEET_ID = "2063880844280742265"

print("=== notes ===")
notes = sb.table("notes").select(
    "note_id, tweet_id, note_text, source_url, submitted_at, cn_status, notewriter_id"
).eq("tweet_id", TWEET_ID).execute().data
for n in notes:
    print(json.dumps(n, indent=2))

print("\n=== pipeline_runs ===")
runs = sb.table("pipeline_runs").select(
    "id, tweet_id, bot_name, outcome, outcome_reason, final_stage, note_id, note_text, created_at"
).eq("tweet_id", TWEET_ID).order("created_at", desc=True).execute().data
for r in runs:
    print(json.dumps(r, indent=2))

print("\n=== pipeline_scores (source_verification) for these runs ===")
for r in runs:
    scores = sb.table("pipeline_scores").select(
        "score_type, score_value, score_label, score_metadata"
    ).eq("pipeline_run_id", r["id"]).execute().data
    sv = [s for s in scores if s["score_type"] == "source_verification"]
    if sv:
        print(f"run {r['id']} ({r['outcome']}):")
        for s in sv:
            print(json.dumps(s, indent=2))

# Dump logs of the most relevant run (submitted/candidate) to look for sources
print("\n=== logs of submitted/candidate run ===")
target = None
for r in runs:
    if r["outcome"] in ("submitted", "candidate"):
        target = r
        break
if target is None and runs:
    target = runs[0]
if target:
    full = sb.table("pipeline_runs").select("logs").eq("id", target["id"]).single().execute().data
    logs = full["logs"]
    out = PROJECT_ROOT / "src/scripts_jim/2026_06_09_find_note_sources/logs_dump.json"
    out.write_text(json.dumps(logs, indent=2))
    print(f"wrote logs for run {target['id']} -> {out}")
    print("top-level log keys:", list(logs.keys()) if isinstance(logs, dict) else type(logs))
