"""Inspect what cost shapes live in pipeline_runs.logs.

Counts how many rows have cost data under each known path:
  - logs.costs.total.cost              (new shape, from 2026-05-06 onwards)
  - logs.{agent,claudeSimple,multiAgent}.costs.total.cost  (legacy)

Helps decide which fallbacks the backfill needs.
"""

import os
from collections import Counter

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

LEGACY_PREFIXES = ["agent", "claudeSimple", "multiAgent"]
PAGE_SIZE = 1000


def main() -> None:
    use_local = os.environ.get("USE_LOCAL_SUPABASE") == "1"
    url = os.environ["LOCAL_SUPABASE_URL" if use_local else "SUPABASE_URL"]
    key = os.environ["LOCAL_SUPABASE_SERVICE_KEY" if use_local else "SUPABASE_SERVICE_KEY"]
    sb = create_client(url, key)
    print(f"Using {'LOCAL' if use_local else 'PROD'} Supabase: {url}")

    counts: Counter[str] = Counter()
    n_rows = 0
    n_with_logs = 0

    offset = 0
    while True:
        rows = (
            sb.table("pipeline_runs")
            .select("id,bot_name,logs")
            .not_.is_("logs", "null")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
            .data
        )
        if not rows:
            break

        for r in rows:
            n_rows += 1
            logs = r.get("logs")
            if not isinstance(logs, dict):
                continue
            n_with_logs += 1

            new_total = (logs.get("costs") or {}).get("total")
            if isinstance(new_total, dict) and new_total.get("cost") is not None:
                counts["new:costs.total.cost"] += 1

            for prefix in LEGACY_PREFIXES:
                bucket = logs.get(prefix)
                if not isinstance(bucket, dict):
                    continue
                total = (bucket.get("costs") or {}).get("total")
                if isinstance(total, dict) and total.get("cost") is not None:
                    counts[f"legacy:{prefix}.costs.total.cost"] += 1

        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    print(f"\nScanned {n_rows} rows ({n_with_logs} with dict logs)")
    print("\nCost path hits (a row can match multiple paths):")
    for path, n in counts.most_common():
        print(f"  {n:>6}  {path}")

    has_any = sum(counts.values())
    print(f"\nTotal path hits: {has_any}")


if __name__ == "__main__":
    main()
