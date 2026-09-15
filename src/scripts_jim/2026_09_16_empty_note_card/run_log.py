# /// script
# requires-python = ">=3.11"
# dependencies = ["supabase", "python-dotenv"]
# ///
"""Dump the pipeline run rows for the claim behind the empty note, so we can
see what the writer and the verifier returned."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
CLAIM_ID = "a7624fd9-3488-4993-8c68-74c4a8dbd682"
OUT = Path(__file__).parent / "data"
OUT.mkdir(exist_ok=True)

probe = sb.table("everything_pipeline_runs").select("*").eq("claim_id", CLAIM_ID).execute().data
print("run rows:", len(probe))
for r in probe:
    slim = {k: v for k, v in r.items() if k not in ("tweet_log", "logs", "log")}
    print(json.dumps(slim, indent=1, default=str)[:3000])
    (OUT / f"run_{r['id']}.json").write_text(json.dumps(r, indent=1, default=str))
    print("keys:", list(r.keys()))
