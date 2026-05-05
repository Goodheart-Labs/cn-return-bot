"""Why do 2026-04-25..28 have hundreds of pipeline_runs but $0 cost?"""

import json
import os
from collections import Counter

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))


def main():
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    rows = (
        sb.table("pipeline_runs")
        .select("id,created_at,bot_id,outcome,outcome_reason,final_stage,logs")
        .gte("created_at", "2026-04-25T00:00:00+00:00")
        .lt("created_at", "2026-04-29T00:00:00+00:00")
        .limit(1000)
        .execute()
        .data
    )
    print(f"Sampled {len(rows)} runs from 04-25..04-28")

    bots = Counter(r["bot_id"] for r in rows)
    outcomes = Counter(f"{r['outcome']}/{r['outcome_reason']}" for r in rows)
    stages = Counter(r["final_stage"] for r in rows)
    has_logs = sum(1 for r in rows if r["logs"])
    has_cost_keys = sum(1 for r in rows if r["logs"] and any(k in r["logs"] for k in ("agent", "claudeSimple", "multiAgent")))

    print("\nBots:", bots.most_common(10))
    print("\nOutcomes:", outcomes.most_common(10))
    print("\nFinal stages:", stages.most_common(10))
    print(f"\nrows with non-null logs: {has_logs}/{len(rows)}")
    print(f"rows with any cost-tracker key in logs: {has_cost_keys}/{len(rows)}")

    print("\nTop-level keys present in logs (sample of first 30 with logs):")
    keysets = Counter()
    for r in rows:
        if r["logs"]:
            keysets[tuple(sorted(r["logs"].keys()))] += 1
    for ks, n in keysets.most_common(10):
        print(f"  {n}x: {list(ks)}")

    # Print one sample log
    sample = next((r for r in rows if r["logs"]), None)
    if sample:
        print("\nSample log (truncated):")
        print(json.dumps(sample["logs"], indent=2)[:2000])


if __name__ == "__main__":
    main()
