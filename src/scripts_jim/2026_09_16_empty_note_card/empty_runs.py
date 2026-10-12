# /// script
# requires-python = ">=3.11"
# dependencies = ["supabase", "python-dotenv"]
# ///
"""For every empty published note, fetch its claim's check run: outcome, the
writer and verifier arms, and cost. Saves the full rows for log digging."""
import json
import os
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
DATA = Path(__file__).parent / "data"
empty = json.loads((DATA / "empty_notes.json").read_text())
claim_ids = [n["claim"]["id"] for n in empty]
runs = sb.table("everything_pipeline_runs").select("*").in_("claim_id", claim_ids).execute().data
print("runs for empty-note claims:", len(runs))
print("outcome:", Counter(r["outcome"] for r in runs))
print("final_stage:", Counter(r["final_stage"] for r in runs))
print("writer arm:", Counter((r["ab_test_picks"] or {}).get("simple_bot_writer") for r in runs))
print("search arm:", Counter((r["ab_test_picks"] or {}).get("simple_bot_search") for r in runs))
print("verifier arm:", Counter((r["ab_test_picks"] or {}).get("simple_bot_verifier") for r in runs))
print("citations:", Counter((r["ab_test_picks"] or {}).get("verifier_citations") for r in runs))
(DATA / "empty_runs.json").write_text(json.dumps(runs, indent=1, default=str))
# Compare with the arms of all AI check runs in the same period.
lo = min(n["created_at"] for n in empty)
all_runs = []
offset = 0
while True:
    chunk = (sb.table("everything_pipeline_runs")
             .select("id, claim_id, outcome, ab_test_picks, created_at")
             .eq("kind", "check").gte("created_at", lo)
             .range(offset, offset + 999).execute().data)
    all_runs.extend(chunk)
    if len(chunk) < 1000:
        break
    offset += 1000
cand = [r for r in all_runs if r["outcome"] == "candidate"]
print("\nall check runs since", lo[:10], ":", len(all_runs), "candidates:", len(cand))
print("candidate writer arms:", Counter((r["ab_test_picks"] or {}).get("simple_bot_writer") for r in cand))
empty_set = set(claim_ids)
by_arm = Counter()
by_arm_empty = Counter()
for r in cand:
    arm = (r["ab_test_picks"] or {}).get("simple_bot_writer")
    by_arm[arm] += 1
    if r["claim_id"] in empty_set:
        by_arm_empty[arm] += 1
for arm in by_arm:
    print(f"  {arm}: {by_arm_empty[arm]} empty of {by_arm[arm]} candidates")
