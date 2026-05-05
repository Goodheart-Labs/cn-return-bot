"""
Phase 0 investigation: fetch all our notes from X API with scoring_status,
write raw responses to JSONL.

Goal: characterize what `scoring_status` actually returns in prod, so we can
finalize the schema for note_rating_tag_counts (esp. whether `model_name` is
needed). The endpoint gates rating data on `has_access`, only true when the
authenticated notewriter is currently top-performing — the local-test
notewriter won't qualify.

Run from repo root:  uv run src/scripts_jim/2026_05_05_rating_endpoint/fetch_with_scoring.py
Output: src/scripts_jim/2026_05_05_rating_endpoint/raw_notes.jsonl
"""

import json
import os
from pathlib import Path

import requests
from requests_oauthlib import OAuth1

PROJECT_ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = PROJECT_ROOT / ".env"


def load_env(path: Path) -> None:
    if not path.exists():
        print(f"Warning: {path} not found")
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        if key and value:
            os.environ.setdefault(key.strip(), value.strip())


load_env(ENV_FILE)

API_KEY = os.environ["LOCAL_X_API_KEY"]
API_KEY_SECRET = os.environ["LOCAL_X_API_KEY_SECRET"]
ACCESS_TOKEN = os.environ["LOCAL_X_ACCESS_TOKEN"]
ACCESS_TOKEN_SECRET = os.environ["LOCAL_X_ACCESS_TOKEN_SECRET"]

URL = "https://api.x.com/2/notes/search/notes_written"
OUT_FILE = Path(__file__).resolve().parent / "raw_notes.jsonl"


def main() -> None:
    auth = OAuth1(API_KEY, API_KEY_SECRET, ACCESS_TOKEN, ACCESS_TOKEN_SECRET)
    next_token: str | None = None
    page = 0
    total = 0

    with OUT_FILE.open("w") as f:
        while True:
            page += 1
            params = {
                "test_mode": "false",
                "max_results": "100",
                "note.fields": "id,info,status,scoring_status",
            }
            if next_token:
                params["pagination_token"] = next_token

            print(f"Page {page}...", flush=True)
            r = requests.get(URL, params=params, auth=auth, timeout=30)
            if not r.ok:
                print(f"  HTTP {r.status_code}: {r.text[:600]}")
                r.raise_for_status()
            body = r.json()

            for note in body.get("data", []) or []:
                f.write(json.dumps(note) + "\n")
                total += 1

            next_token = (body.get("meta") or {}).get("next_token")
            if not next_token:
                break

    print(f"\nDone. {total} notes written to {OUT_FILE}")


if __name__ == "__main__":
    main()
