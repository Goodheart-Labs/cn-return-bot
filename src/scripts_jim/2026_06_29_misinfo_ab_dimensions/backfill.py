"""Backfill the misinfo A/B dimensions onto historical pipeline_runs.

Tags the runs that came from the XXL-feed misinfo pre-pass with the two new
pseudo-A/B picks so they show up under the dashboards' MISINFO_MONITORING /
MISINFO_TOPIC dropdowns:

    ab_test_picks.misinfo_monitoring = "yes"
    ab_test_picks.misinfo_topic      = <topic_id>

Source of truth is the misinfo_monitoring_sightings ledger: each processed
sighting links processed_run_id -> the run and topic_id -> the topic (one
processed run maps to exactly one topic). Regular (non-misinfo) runs are
deliberately left untagged — they resolve to the default no/none and show under
"all" (mirrors how feed_size was rolled out). New runs get both picks
automatically via processPosts, so this only backfills history.

Writes ab_test_picks only (the indexed column both dashboards read); the
logs.bot.picks debug snapshot is left as-is for historical rows. Idempotent —
already-tagged runs are skipped, so it's safe to re-run.

Usage:
  USE_LOCAL_SUPABASE=1 DRY_RUN=1 uv run src/scripts_jim/2026_06_29_misinfo_ab_dimensions/backfill.py
  USE_LOCAL_SUPABASE=1 uv run src/scripts_jim/2026_06_29_misinfo_ab_dimensions/backfill.py
  uv run src/scripts_jim/2026_06_29_misinfo_ab_dimensions/backfill.py   # prod (asks for confirmation)
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from collections import Counter
from typing import Optional

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

PAGE_SIZE = 1000
READ_CHUNK = 100
HTTP_TIMEOUT_S = 120


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
    req = urllib.request.Request(full_url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
        body_bytes = r.read()
        return json.loads(body_bytes) if body_bytes else []


def fetch_processed_sightings(url: str, key: str) -> dict[str, str]:
    """run_id -> topic_id for every processed misinfo sighting (id-paginated)."""
    run_topic: dict[str, str] = {}
    last_id: Optional[int] = None
    while True:
        params = {
            "select": "id,processed_run_id,topic_id",
            "processed_run_id": "not.is.null",
            "order": "id.asc",
            "limit": PAGE_SIZE,
        }
        if last_id is not None:
            params["id"] = f"gt.{last_id}"
        rows = rest_request(url, key, "GET", "misinfo_monitoring_sightings", params)
        if not rows:
            break
        for r in rows:
            # One processed run -> one topic; first wins (defensive — markMisinfoProcessed
            # only stamps a single sighting per run).
            run_topic.setdefault(r["processed_run_id"], r["topic_id"])
        last_id = rows[-1]["id"]
    return run_topic


def chunks(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


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

    run_topic = fetch_processed_sightings(url, key)
    print(f"Processed misinfo sightings: {len(run_topic)} run(s)")
    topic_counts = Counter(run_topic.values())

    n_updated = 0
    n_already = 0
    n_missing = 0
    for chunk in chunks(list(run_topic.keys()), READ_CHUNK):
        id_list = ",".join(chunk)
        existing = rest_request(
            url, key, "GET", "pipeline_runs",
            {"select": "id,ab_test_picks", "id": f"in.({id_list})"},
        )
        picks_by_id = {r["id"]: (r.get("ab_test_picks") or {}) for r in existing}
        for run_id in chunk:
            topic_id = run_topic[run_id]
            picks = picks_by_id.get(run_id)
            if picks is None:
                n_missing += 1  # FK guarantees it exists, but be honest if it doesn't
                continue
            if picks.get("misinfo_monitoring") == "yes" and picks.get("misinfo_topic") == topic_id:
                n_already += 1
                continue
            merged = {**picks, "misinfo_monitoring": "yes", "misinfo_topic": topic_id}
            if not dry_run:
                rest_request(
                    url, key, "PATCH", "pipeline_runs",
                    {"id": f"eq.{run_id}"},
                    body={"ab_test_picks": merged},
                )
            n_updated += 1

    print("\n--- Summary ---")
    print(f"Misinfo runs found:          {len(run_topic)}")
    print(f"  Updated:                   {n_updated}{' (DRY RUN)' if dry_run else ''}")
    print(f"  Already tagged (skipped):  {n_already}")
    print(f"  Run not found:             {n_missing}")
    print("\nPer-topic breakdown:")
    for topic, count in sorted(topic_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {topic:24} {count}")


if __name__ == "__main__":
    main()
