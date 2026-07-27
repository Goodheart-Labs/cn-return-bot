"""Apply migration 065 to prod: pin Zvi's Substack to the top of the project list."""

import os

import requests
from dotenv import load_dotenv

load_dotenv()

URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def main():
    resp = requests.patch(
        f"{URL}/rest/v1/everything_projects",
        params={"slug": "eq.zvi"},
        json={"sort_order": -1},
        headers={**HEADERS, "Prefer": "return=representation"},
    )
    resp.raise_for_status()
    print("updated:", resp.json())

    check = requests.get(
        f"{URL}/rest/v1/everything_projects",
        params={"select": "slug,sort_order", "order": "sort_order"},
        headers=HEADERS,
    )
    check.raise_for_status()
    print("projects:", check.json())


if __name__ == "__main__":
    main()
