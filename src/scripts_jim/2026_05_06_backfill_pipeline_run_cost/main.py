"""Backfill pipeline_runs.cost from logs.

Cost path priority (first hit wins):
  1. logs.costs.total.cost                      (current shape)
  2. logs.{agent,claudeSimple,multiAgent}.costs.total.cost  (legacy)

Rows with no cost data in logs stay NULL — they predate cost tracking or the
bot crashed before aggregateAndLogCosts ran. NULL is the honest signal.

Usage:
  USE_LOCAL_SUPABASE=1 DRY_RUN=1 uv run src/scripts_jim/2026_05_06_backfill_pipeline_run_cost/main.py
  USE_LOCAL_SUPABASE=1 uv run src/scripts_jim/2026_05_06_backfill_pipeline_run_cost/main.py
  uv run src/scripts_jim/2026_05_06_backfill_pipeline_run_cost/main.py   # prod (asks for confirmation)
"""

import os
import sys
from typing import Optional

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

LEGACY_PREFIXES = ["agent", "claudeSimple", "multiAgent"]
PAGE_SIZE = 500


def extract_cost(logs: dict) -> Optional[float]:
    """Pull total run cost from logs, trying current then legacy paths."""
    total = (logs.get("costs") or {}).get("total")
    if isinstance(total, dict) and isinstance(total.get("cost"), (int, float)):
        return float(total["cost"])

    for prefix in LEGACY_PREFIXES:
        bucket = logs.get(prefix)
        if not isinstance(bucket, dict):
            continue
        total = (bucket.get("costs") or {}).get("total")
        if isinstance(total, dict) and isinstance(total.get("cost"), (int, float)):
            return float(total["cost"])

    return None


def main() -> None:
    use_local = os.environ.get("USE_LOCAL_SUPABASE") == "1"
    dry_run = os.environ.get("DRY_RUN") == "1"
    url = os.environ["LOCAL_SUPABASE_URL" if use_local else "SUPABASE_URL"]
    key = os.environ["LOCAL_SUPABASE_SERVICE_KEY" if use_local else "SUPABASE_SERVICE_KEY"]

    if not use_local and not dry_run:
        confirm = input(f"About to UPDATE rows on PROD ({url}). Type 'yes' to proceed: ")
        if confirm.strip() != "yes":
            print("Aborted.")
            sys.exit(1)

    sb = create_client(url, key)
    print(f"Using {'LOCAL' if use_local else 'PROD'} Supabase: {url} (dry_run={dry_run})")

    n_scanned = 0
    n_extracted = 0
    n_no_cost = 0
    n_updated = 0
    cost_samples: list[float] = []

    last_id: Optional[str] = None
    while True:
        # Cursor-paginate by id ASC. Filter for rows where cost is still NULL
        # and logs is present — keeps reruns cheap and idempotent.
        q = (
            sb.table("pipeline_runs")
            .select("id,logs")
            .is_("cost", "null")
            .not_.is_("logs", "null")
            .order("id")
            .limit(PAGE_SIZE)
        )
        if last_id is not None:
            q = q.gt("id", last_id)
        rows = q.execute().data

        if not rows:
            break

        updates: list[tuple[str, float]] = []
        for r in rows:
            n_scanned += 1
            logs = r.get("logs") or {}
            cost = extract_cost(logs) if isinstance(logs, dict) else None
            if cost is None:
                n_no_cost += 1
                continue
            n_extracted += 1
            cost_samples.append(cost)
            updates.append((r["id"], cost))

        if updates and not dry_run:
            for run_id, cost in updates:
                # NUMERIC(10,6) → cap at 9999.999999. No real run hits that.
                sb.table("pipeline_runs").update({"cost": round(cost, 6)}).eq("id", run_id).execute()
                n_updated += 1

        last_id = rows[-1]["id"]
        print(
            f"  scanned={n_scanned} extracted={n_extracted} "
            f"no_cost={n_no_cost} updated={n_updated}"
        )

    print("\n--- Summary ---")
    print(f"Rows scanned (cost IS NULL & logs IS NOT NULL): {n_scanned}")
    print(f"  Cost extracted from logs:                     {n_extracted}")
    print(f"  No cost data in logs (left NULL):             {n_no_cost}")
    print(f"  Rows updated:                                 {n_updated}{' (DRY RUN)' if dry_run else ''}")

    if cost_samples:
        cost_samples.sort()
        print("\nCost distribution (USD):")
        n = len(cost_samples)
        print(f"  count:  {n}")
        print(f"  min:    ${cost_samples[0]:.6f}")
        print(f"  median: ${cost_samples[n // 2]:.6f}")
        print(f"  p95:    ${cost_samples[int(n * 0.95)]:.6f}")
        print(f"  max:    ${cost_samples[-1]:.6f}")
        print(f"  sum:    ${sum(cost_samples):.2f}")


if __name__ == "__main__":
    main()
