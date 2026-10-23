# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "python-dotenv"]
# ///
"""Download OpenRouter spend data with the management key (GOO-461).

Read-only: only GET /keys, GET /activity, GET /analytics/meta and POST
/analytics/query, which reads and never changes anything.

The management key is OPENROUTER_MGMT_KEY in the root .env. It is sent only in
the Authorization header to openrouter.ai and never written anywhere. The raw
responses land in raw/ (gitignored), with each key's `label` removed, because
the label shows the first and last characters of the secret key.

Run from the workspace root:
    uv run src/scripts_jim/2026_10_18_openrouter_spend/fetch.py
"""

import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

API = "https://openrouter.ai/api/v1"
RAW_DIR = Path(__file__).parent / "raw"
ACTIVITY_WINDOW_DAYS = 30
REQUEST_TIMEOUT_SECONDS = 120

load_dotenv()
session = requests.Session()
session.headers["Authorization"] = f"Bearer {os.environ['OPENROUTER_MGMT_KEY']}"


def get(path: str, params: dict | None = None) -> dict:
    response = session.get(f"{API}{path}", params=params, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def analytics_query(body: dict) -> dict:
    response = session.post(f"{API}/analytics/query", json=body, timeout=REQUEST_TIMEOUT_SECONDS)
    if not response.ok:
        raise RuntimeError(f"analytics query failed: {response.status_code} {response.text[:500]}")
    result = response.json()["data"]
    if result["metadata"]["truncated"]:
        raise RuntimeError(f"analytics query truncated: {json.dumps(body)}")
    return result


def save(name: str, data) -> None:
    (RAW_DIR / f"{name}.json").write_text(json.dumps(data, indent=1))


def list_all_keys() -> list[dict]:
    keys: list[dict] = []
    while True:
        page = get("/keys", {"include_disabled": "true", "include_expired": "true", "offset": len(keys)})["data"]
        if not page:
            return keys
        keys.extend({k: v for k, v in key.items() if k != "label"} for key in page)


def iso_seconds(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> None:
    RAW_DIR.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc)
    save("fetched_at", {"fetched_at": iso_seconds(now)})

    save("keys", list_all_keys())
    save("analytics_meta", get("/analytics/meta")["data"])

    # /activity covers the last 30 completed UTC days, one date per call.
    today = now.date()
    activity = []
    for offset in range(ACTIVITY_WINDOW_DAYS, 0, -1):
        day = (today - timedelta(days=offset)).isoformat()
        activity.extend(get("/activity", {"date": day})["data"])
    save("activity", activity)

    window_start = datetime.combine(today - timedelta(days=ACTIVITY_WINDOW_DAYS), datetime.min.time(), timezone.utc)
    time_range = {"start": iso_seconds(window_start), "end": iso_seconds(now)}
    spend_metrics = ["total_usage", "request_count"]
    save("hourly_by_key", analytics_query(
        {"metrics": spend_metrics, "dimensions": ["api_key_id"], "granularity": "hour", "time_range": time_range, "limit": 100000}
    ))
    save("daily_by_key_model", analytics_query(
        {"metrics": spend_metrics + ["tokens_total"], "dimensions": ["api_key_id", "model"], "granularity": "day", "time_range": time_range, "limit": 100000}
    ))


if __name__ == "__main__":
    main()
