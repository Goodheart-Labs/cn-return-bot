"""Try Bearer token + OAuth2 client-credentials against notes_written."""

import os
from base64 import b64encode
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = PROJECT_ROOT / ".env"

for line in ENV_FILE.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    k, _, v = line.partition("=")
    if k and v:
        os.environ.setdefault(k.strip(), v.strip())

URL = "https://api.x.com/2/notes/search/notes_written"

# 1. App-only Bearer
print("=== Bearer Token (app-only) ===")
bearer = os.environ.get("X_BEARER_TOKEN")
if not bearer:
    print("  X_BEARER_TOKEN unset")
else:
    for tm in ("false", "true"):
        r = requests.get(
            URL,
            params={"test_mode": tm, "max_results": "1", "note.fields": "id,info,status,scoring_status"},
            headers={"Authorization": f"Bearer {bearer}"},
            timeout=15,
        )
        try:
            detail = r.json().get("detail", r.text) if not r.ok else "OK"
        except Exception:
            detail = r.text
        print(f"  test_mode={tm}: HTTP {r.status_code} — {detail[:200]}")

# 2. OAuth2 client-credentials → mint a bearer, then call
print("\n=== OAuth2 client_credentials ===")
client_id = os.environ.get("X_CLIENT_ID")
client_secret = os.environ.get("X_CLIENT_SECRET")
if not (client_id and client_secret):
    print("  X_CLIENT_ID/SECRET unset")
else:
    auth_header = b64encode(f"{client_id}:{client_secret}".encode()).decode()
    token_r = requests.post(
        "https://api.x.com/2/oauth2/token",
        data={"grant_type": "client_credentials"},
        headers={"Authorization": f"Basic {auth_header}", "Content-Type": "application/x-www-form-urlencoded"},
        timeout=15,
    )
    print(f"  token endpoint: HTTP {token_r.status_code}")
    if token_r.ok:
        token = token_r.json().get("access_token")
        for tm in ("false", "true"):
            r = requests.get(
                URL,
                params={"test_mode": tm, "max_results": "1", "note.fields": "id,info,status,scoring_status"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
            try:
                detail = r.json().get("detail", r.text) if not r.ok else "OK"
            except Exception:
                detail = r.text
            print(f"  test_mode={tm}: HTTP {r.status_code} — {detail[:200]}")
    else:
        print(f"  body: {token_r.text[:200]}")
