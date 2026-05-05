"""Of failed runs that have a cost-tracker key, do their costs.total.cost = 0?"""

import json
import os

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

PREFIXES = ["agent", "claudeSimple", "multiAgent"]


def main():
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    rows = (
        sb.table("pipeline_runs")
        .select("id,created_at,bot_id,outcome,outcome_reason,logs")
        .gte("created_at", "2026-04-25T00:00:00+00:00")
        .lt("created_at", "2026-04-29T00:00:00+00:00")
        .limit(1000)
        .execute()
        .data
    )

    n_total = len(rows)
    n_with_prefix = 0
    n_with_costs_subkey = 0
    n_with_total_subkey = 0
    n_with_nonzero_cost = 0
    sample_costs = []

    for r in rows:
        logs = r.get("logs") or {}
        for p in PREFIXES:
            if p in logs:
                n_with_prefix += 1
                sub = logs[p]
                if isinstance(sub, dict) and "costs" in sub:
                    n_with_costs_subkey += 1
                    if isinstance(sub["costs"], dict) and "total" in sub["costs"]:
                        n_with_total_subkey += 1
                        cost = sub["costs"]["total"].get("cost", 0)
                        if cost > 0:
                            n_with_nonzero_cost += 1
                        sample_costs.append((r["id"], p, sub["costs"]["total"]))
                break

    print(f"total rows: {n_total}")
    print(f"  with cost-tracker prefix key: {n_with_prefix}")
    print(f"  ...with .costs subkey:        {n_with_costs_subkey}")
    print(f"  ......with .costs.total:      {n_with_total_subkey}")
    print(f"  .........with cost > 0:       {n_with_nonzero_cost}")

    print("\nSample of present costs.total objects:")
    for sid, p, t in sample_costs[:5]:
        print(f"  {sid[:8]} {p}: {t}")

    print("\nKeys present in {prefix} when costs is missing (bot crashed before aggregateAndLogCosts):")
    no_costs_examples = 0
    for r in rows:
        logs = r.get("logs") or {}
        for p in PREFIXES:
            if p in logs and "costs" not in (logs[p] if isinstance(logs[p], dict) else {}):
                if no_costs_examples < 3:
                    print(f"  {r['bot_id']} (outcome={r['outcome']}/{r['outcome_reason']}): {p} keys = {list(logs[p].keys())}")
                    no_costs_examples += 1


if __name__ == "__main__":
    main()
