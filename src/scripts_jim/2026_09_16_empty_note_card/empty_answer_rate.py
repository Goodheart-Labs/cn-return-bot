# /// script
# requires-python = ">=3.11"
# dependencies = ["supabase", "python-dotenv"]
# ///
"""How often does the writer answer with an empty note in the Common Notes
pipeline, and what does the verifier then do with it? Also: which verifier
flavour do the X runs in the sample use."""
import os
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

first = sb.table("everything_pipeline_runs").select("created_at").eq("kind", "check").order("created_at").limit(1).execute().data
print("first everything check run:", first)

rows, offset = [], 0
while True:
    chunk = (sb.table("everything_pipeline_runs")
             .select("id, outcome, outcome_reason, final_stage, ab_test_picks, created_at, logs->note, logs->sourceCheck, logs->eval")
             .eq("kind", "check")
             .eq("logs->note->>text", "")
             .not_.is_("logs->note->>status", "null")
             .range(offset, offset + 999).execute().data)
    rows.extend(chunk)
    if len(chunk) < 1000:
        break
    offset += 1000
reached_writer = [r for r in rows if r["note"]["status"] == "CORRECTION WITH TRUSTWORTHY CITATION"]
print("everything check runs whose final note text is empty:", len(rows))
print("  of those, search said no correction (status NO MISSING CONTEXT etc.):", Counter(r["note"]["status"] for r in rows))
print("  writer answered empty and status stayed CORRECTION:", len(reached_writer))
print("  outcome of those:", Counter((r["outcome"], r["outcome_reason"]) for r in reached_writer))
print("  verifier verdict of those:", Counter((r["sourceCheck"] or {}).get("result", "")[:3] for r in reached_writer))
print("  verifier arm/flavour:", Counter(((r["ab_test_picks"] or {}).get("simple_bot_verifier"), (r["ab_test_picks"] or {}).get("verifier_claim_based")) for r in reached_writer))
print("  writer arm:", Counter((r["ab_test_picks"] or {}).get("simple_bot_writer") for r in reached_writer))
print("  eval error of accepted ones:", Counter(((r["eval"] or {}).get("error") or "")[:45] for r in reached_writer if r["outcome"] == "candidate"))
print("  by month:", sorted(Counter(r["created_at"][:7] for r in reached_writer).items()))

xs = (sb.table("pipeline_runs").select("ab_test_picks")
      .gte("created_at", "2026-09-11").lt("created_at", "2026-09-12")
      .eq("logs->note->>status", "CORRECTION WITH TRUSTWORTHY CITATION")
      .eq("logs->note->>text", "").limit(200).execute().data)
print("X runs 2026-09-11 with an empty note that reached the verifier:", len(xs))
print("  verifier flavour:", Counter((r["ab_test_picks"] or {}).get("verifier_claim_based") for r in xs))
