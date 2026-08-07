"""Inspect Jim's everything_votes + everything_donations rows in prod.

Jim voted on commonnotes.net and switched the donation charity to ACE, but the
DB allegedly still says give_directly. Look at the raw rows before theorizing.

Run from repo root: uv run src/scripts_jim/2026_07_21_donation_charity_fix/inspect.py
"""

import os

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}

JIM_EMAIL = "jimmaar1@gmail.com"


def find_user_id(email: str) -> str:
    # GoTrue admin API: list users, filter by email client-side (small user base).
    resp = requests.get(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=HEADERS,
        params={"per_page": 200},
        timeout=30,
    )
    resp.raise_for_status()
    users = resp.json()["users"]
    matches = [u for u in users if u.get("email") == email]
    if not matches:
        raise SystemExit(f"No auth user with email {email} among {len(users)} users")
    return matches[0]["id"]


def rest(path: str, params: dict) -> list[dict]:
    resp = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=HEADERS, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def main() -> None:
    user_id = find_user_id(JIM_EMAIL)
    print(f"user_id: {user_id}\n")

    votes = rest(
        "everything_votes",
        {
            "voter_id": f"eq.{user_id}",
            "select": "id,note_id,vote,created_at",
            "order": "created_at.desc",
            "limit": "15",
        },
    )
    print(f"latest {len(votes)} votes:")
    for v in votes:
        print(f"  {v['created_at']}  vote={v['vote']:>2}  vote_id={v['id']}  note={v['note_id']}")

    vote_ids = ",".join(v["id"] for v in votes)
    donations = rest(
        "everything_donations",
        {
            "vote_id": f"in.({vote_ids})",
            "select": "id,vote_id,charity,amount_if_helpful,amount_if_not_helpful,amount_usd,created_at",
            "order": "created_at.desc",
        },
    )
    print(f"\ndonations on those votes ({len(donations)}):")
    for d in donations:
        print(
            f"  {d['created_at']}  charity={d['charity']:<14} "
            f"pair=({d['amount_if_helpful']}, {d['amount_if_not_helpful']})  settled={d['amount_usd']}  vote_id={d['vote_id']}"
        )


if __name__ == "__main__":
    main()
