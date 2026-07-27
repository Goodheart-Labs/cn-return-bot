"""One-off: apply Jim's intended charity switch that the UI silently dropped.

His 19:56:51 donation (vote c2f7e337) stayed give_directly after he picked ACE
in the picker. Requested fix: set it to ace, echoing before/after.

Run from repo root: uv run src/scripts_jim/2026_07_21_donation_charity_fix/fix_jim_row.py
"""

import os

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}

VOTE_ID = "c2f7e337-6342-4444-b586-d3a6826c4643"  # Jim's 19:56:51 donation


def show(label: str) -> None:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/everything_donations",
        headers=HEADERS,
        params={"vote_id": f"eq.{VOTE_ID}", "select": "charity,amount_if_helpful,amount_if_not_helpful,created_at"},
        timeout=30,
    )
    r.raise_for_status()
    print(f"{label}: {r.json()}")


def main() -> None:
    show("before")
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/everything_donations",
        headers={**HEADERS, "Prefer": "return=representation"},
        params={"vote_id": f"eq.{VOTE_ID}"},
        json={"charity": "ace"},
        timeout=30,
    )
    r.raise_for_status()
    print(f"update: {r.status_code}, {len(r.json())} row(s)")
    show("after")


if __name__ == "__main__":
    main()
