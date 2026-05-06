"""Backfill pipeline_runs.cost from logs.

Cost path priority (first hit wins):
  1. logs.costs.total.cost                                  (current shape)
  2. logs.{agent,claudeSimple,multiAgent}.costs.total.cost  (legacy)

Rows with no cost data in logs stay NULL — they predate cost tracking or the
bot crashed before aggregateAndLogCosts ran. NULL is the honest signal.

Reads project just the four cost paths server-side; pulling the full `logs`
JSONB column hits the prod statement_timeout because every row has to be
detoasted and shipped to the client.

Usage:
  USE_LOCAL_SUPABASE=1 DRY_RUN=1 uv run src/scripts_jim/2026_05_06_backfill_pipeline_run_cost/main.py
  USE_LOCAL_SUPABASE=1 uv run src/scripts_jim/2026_05_06_backfill_pipeline_run_cost/main.py
  uv run src/scripts_jim/2026_05_06_backfill_pipeline_run_cost/main.py   # prod (asks for confirmation)
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

# Small pages keep the per-query detoast burst under prod's statement_timeout.
# A page that hits a row with unusually large `logs` will retry; if the retry
# also fails, the script bails (rerunning resumes via the `cost IS NULL` filter).
PAGE_SIZE = 50
HTTP_TIMEOUT_S = 120
MAX_RETRIES = 3
RETRY_SLEEP_S = 5

SELECT_FIELDS = (
    "id,"
    "current_cost:logs->costs->total->>cost,"
    "agent_cost:logs->agent->costs->total->>cost,"
    "simple_cost:logs->claudeSimple->costs->total->>cost,"
    "multi_cost:logs->multiAgent->costs->total->>cost"
)
COST_KEYS = ["current_cost", "agent_cost", "simple_cost", "multi_cost"]


def extract_cost(row: dict) -> Optional[float]:
    """First non-null cost field wins. Values arrive as strings (`->>`)."""
    for k in COST_KEYS:
        v = row.get(k)
        if v is not None:
            return float(v)
    return None


def rest_request(
    url: str, key: str, method: str, path: str, params: dict, body: Optional[dict] = None,
) -> list[dict]:
    full_url = f"{url}/rest/v1/{path}?{urllib.parse.urlencode(params)}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode() if body is not None else None

    # Retry transient 5xx (statement_timeout, gateway hiccups). Don't retry 4xx.
    for attempt in range(MAX_RETRIES):
        req = urllib.request.Request(full_url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
                resp = r.read()
                return json.loads(resp) if resp else []
        except urllib.error.HTTPError as e:
            if e.code >= 500 and attempt < MAX_RETRIES - 1:
                print(f"    {method} {path} → {e.code}, retrying in {RETRY_SLEEP_S}s ({attempt + 1}/{MAX_RETRIES - 1})")
                time.sleep(RETRY_SLEEP_S)
                continue
            raise
    raise RuntimeError("unreachable")


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

    print(f"Using {'LOCAL' if use_local else 'PROD'} Supabase: {url} (dry_run={dry_run})")

    n_scanned = 0
    n_extracted = 0
    n_no_cost = 0
    n_updated = 0
    cost_samples: list[float] = []

    last_id: Optional[str] = None
    while True:
        params = {
            "select": SELECT_FIELDS,
            "cost": "is.null",
            "logs": "not.is.null",
            "order": "id.asc",
            "limit": PAGE_SIZE,
        }
        if last_id is not None:
            params["id"] = f"gt.{last_id}"

        rows = rest_request(url, key, "GET", "pipeline_runs", params)
        if not rows:
            break

        for r in rows:
            n_scanned += 1
            cost = extract_cost(r)
            if cost is None:
                n_no_cost += 1
                continue
            n_extracted += 1
            cost_samples.append(cost)
            if not dry_run:
                rest_request(
                    url, key, "PATCH", "pipeline_runs",
                    {"id": f"eq.{r['id']}"},
                    body={"cost": round(cost, 6)},
                )
                n_updated += 1

        last_id = rows[-1]["id"]
        print(
            f"  scanned={n_scanned} extracted={n_extracted} "
            f"no_cost={n_no_cost} updated={n_updated} last_id={last_id[:8]}"
        )

    print("\n--- Summary ---")
    print(f"Rows scanned (cost IS NULL & logs IS NOT NULL): {n_scanned}")
    print(f"  Cost extracted from logs:                     {n_extracted}")
    print(f"  No cost data in logs (left NULL):             {n_no_cost}")
    print(f"  Rows updated:                                 {n_updated}{' (DRY RUN)' if dry_run else ''}")

    if cost_samples:
        cost_samples.sort()
        n = len(cost_samples)
        print("\nCost distribution (USD):")
        print(f"  count:  {n}")
        print(f"  min:    ${cost_samples[0]:.6f}")
        print(f"  median: ${cost_samples[n // 2]:.6f}")
        print(f"  p95:    ${cost_samples[int(n * 0.95)]:.6f}")
        print(f"  max:    ${cost_samples[-1]:.6f}")
        print(f"  sum:    ${sum(cost_samples):.2f}")


if __name__ == "__main__":
    main()
