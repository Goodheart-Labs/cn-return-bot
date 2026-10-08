# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "python-dotenv"]
# ///
"""Read-only download of claims, notes and item texts from the production database into cache/."""

import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).parent
CACHE = HERE / "cache"
REPO_ROOT = HERE.parents[2]

load_dotenv(REPO_ROOT / ".env")
SUPABASE_URL = os.environ["SUPABASE_URL"]
HEADERS = {
    "apikey": os.environ["SUPABASE_SERVICE_KEY"],
    "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
}

CLAIM_PAGE_SIZE = 200
NOTE_PAGE_SIZE = 500
ITEM_BATCH_SIZE = 10
MIN_PAGE_SIZE = 1
REQUEST_TIMEOUT_SECONDS = 60
RETRIES_PER_SIZE = 2

CLAIM_COLUMNS = "id,item_id,claim,context_quote,context_paragraph,judgement,status,created_at"
NOTE_COLUMNS = "id,claim_id,author_id,status"
ITEM_COLUMNS = "id,title,url,source,full_text"


def get_rows(table: str, params: dict[str, str]) -> list[dict]:
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        params=params,
        headers=HEADERS,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def get_rows_halving(table: str, params: dict[str, str], page_size: int) -> list[dict]:
    """Request a page. If the request fails, halve the page size and retry."""
    while True:
        for _ in range(RETRIES_PER_SIZE):
            try:
                return get_rows(table, {**params, "limit": str(page_size)})
            except requests.RequestException as error:
                print(f"  {table} page size {page_size} failed: {error}", file=sys.stderr)
                time.sleep(1)
        if page_size <= MIN_PAGE_SIZE:
            raise RuntimeError(f"{table} still failing at page size {MIN_PAGE_SIZE}")
        page_size = max(MIN_PAGE_SIZE, page_size // 2)


def fetch_keyset(table: str, columns: str, page_size: int) -> list[dict]:
    rows: list[dict] = []
    last_id = None
    while True:
        params = {"select": columns, "order": "id.asc"}
        if last_id is not None:
            params["id"] = f"gt.{last_id}"
        page = get_rows_halving(table, params, page_size)
        rows.extend(page)
        print(f"  {table}: {len(rows)} rows", end="\r")
        if not page:
            print()
            return rows
        last_id = page[-1]["id"]


def fetch_items(item_ids: list[str]) -> dict[str, dict]:
    items: dict[str, dict] = {}
    for start in range(0, len(item_ids), ITEM_BATCH_SIZE):
        batch = item_ids[start : start + ITEM_BATCH_SIZE]
        page = get_rows_halving(
            "everything_items",
            {"select": ITEM_COLUMNS, "id": f"in.({','.join(batch)})"},
            len(batch),
        )
        items.update({row["id"]: row for row in page})
        print(f"  items: {len(items)}/{len(item_ids)}", end="\r")
    print()
    return items


def cached(name: str, produce):
    path = CACHE / name
    if path.exists():
        return json.loads(path.read_text())
    data = produce()
    CACHE.mkdir(exist_ok=True)
    path.write_text(json.dumps(data))
    return data


def load_data() -> tuple[list[dict], list[dict], dict[str, dict]]:
    claims = cached("claims.json", lambda: fetch_keyset("everything_claims", CLAIM_COLUMNS, CLAIM_PAGE_SIZE))
    notes = cached("notes.json", lambda: fetch_keyset("everything_notes", NOTE_COLUMNS, NOTE_PAGE_SIZE))
    item_ids = sorted({c["item_id"] for c in claims if c["judgement"] != "user" and c["context_quote"]})
    items = cached("items.json", lambda: fetch_items(item_ids))
    return claims, notes, items


if __name__ == "__main__":
    claims, notes, items = load_data()
    print(f"{len(claims)} claims, {len(notes)} notes, {len(items)} items")
