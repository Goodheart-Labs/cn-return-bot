"""Reproduce the silent charity-update failure as a real authenticated user.

Jim's 19:56 donation stayed give_directly after he picked ACE. The client does
a bare PostgREST UPDATE keyed on vote_id. Repro: throwaway user -> vote ->
mint donation (give_directly) -> attempt the exact UPDATE the client sends ->
read back with the service key. Cleanup deletes the vote (cascades the
donation; counter trigger reverts the tally).

The prod anon key is public (shipped in the commonnotes.net bundle), so we
scrape it from there rather than needing .env.prod-backend.

Run from repo root: uv run src/scripts_jim/2026_07_21_donation_charity_fix/repro_update.py
"""

import os
import re
import secrets

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ADMIN_HEADERS = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}

TEST_EMAIL = "donation-repro-test@example.com"
# The note Jim's stuck donation is on — same target, maximal fidelity.
NOTE_ID = "65cc8778-3127-42ec-a1ad-fcfc277c5bb7"


def scrape_anon_key() -> str:
    html = requests.get("https://commonnotes.net/", timeout=30).text
    bundle_path = re.search(r'src="(/assets/index-[^"]+\.js)"', html).group(1)
    bundle = requests.get(f"https://commonnotes.net{bundle_path}", timeout=30).text
    jwts = [t for t in re.findall(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", bundle)]
    if not jwts:
        raise SystemExit("No anon key found in bundle")
    return jwts[0]


def cleanup_test_user() -> None:
    resp = requests.get(
        f"{SUPABASE_URL}/auth/v1/admin/users", headers=ADMIN_HEADERS, params={"per_page": 200}, timeout=30
    )
    for u in resp.json()["users"]:
        if u.get("email") == TEST_EMAIL:
            requests.delete(f"{SUPABASE_URL}/auth/v1/admin/users/{u['id']}", headers=ADMIN_HEADERS, timeout=30)
            print(f"cleanup: deleted test user {u['id']}")


def main() -> None:
    anon_key = scrape_anon_key()
    print(f"anon key scraped ({anon_key[:20]}...)")

    cleanup_test_user()  # idempotent re-runs

    password = secrets.token_urlsafe(16)
    created = requests.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=ADMIN_HEADERS,
        json={"email": TEST_EMAIL, "password": password, "email_confirm": True},
        timeout=30,
    )
    created.raise_for_status()
    user_id = created.json()["id"]
    print(f"test user: {user_id}")

    signin = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": anon_key},
        json={"email": TEST_EMAIL, "password": password},
        timeout=30,
    )
    signin.raise_for_status()
    jwt = signin.json()["access_token"]
    user_headers = {"apikey": anon_key, "Authorization": f"Bearer {jwt}"}

    try:
        # 1. Vote (exactly like castVote: upsert then read id).
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/everything_votes",
            headers={**user_headers, "Prefer": "resolution=merge-duplicates"},
            params={"on_conflict": "note_id,voter_id"},
            json={"note_id": NOTE_ID, "voter_id": user_id, "vote": -1},
            timeout=30,
        )
        print(f"vote upsert: {r.status_code} {r.text[:200]}")
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/everything_votes",
            headers=user_headers,
            params={"note_id": f"eq.{NOTE_ID}", "select": "id"},
            timeout=30,
        )
        vote_id = r.json()[0]["id"]
        print(f"vote_id: {vote_id}")

        # 2. Mint donation (exactly like saveDonation: upsert on vote_id).
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/everything_donations",
            headers={**user_headers, "Prefer": "resolution=merge-duplicates"},
            params={"on_conflict": "vote_id"},
            json={"vote_id": vote_id, "charity": "give_directly", "amount_if_helpful": 0.5, "amount_if_not_helpful": 0.5},
            timeout=30,
        )
        print(f"donation mint: {r.status_code} {r.text[:200]}")

        # 3. THE suspect operation — exactly like setDonationCharity.
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/everything_donations",
            headers=user_headers,
            params={"vote_id": f"eq.{vote_id}"},
            json={"charity": "ace"},
            timeout=30,
        )
        print(f"charity update: {r.status_code} body={r.text[:300]!r} content-range={r.headers.get('content-range')}")

        # 4. Read back with service key (ground truth, bypasses RLS).
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/everything_donations",
            headers=ADMIN_HEADERS,
            params={"vote_id": f"eq.{vote_id}", "select": "charity"},
            timeout=30,
        )
        print(f"ground truth after update: {r.json()}")
    finally:
        # Cleanup: delete vote (cascades donation, reverts counter), drop user.
        r = requests.delete(
            f"{SUPABASE_URL}/rest/v1/everything_votes",
            headers=ADMIN_HEADERS,
            params={"voter_id": f"eq.{user_id}"},
            timeout=30,
        )
        print(f"cleanup vote: {r.status_code}")
        cleanup_test_user()


if __name__ == "__main__":
    main()
