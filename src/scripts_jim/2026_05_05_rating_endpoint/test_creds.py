"""Try each cred set to see which (if any) is admitted to write product notes."""

import os
from pathlib import Path

import requests
from requests_oauthlib import OAuth1

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

cred_sets = [
    ("X_*", "X_API_KEY", "X_API_KEY_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"),
    ("LOCAL_X_*", "LOCAL_X_API_KEY", "LOCAL_X_API_KEY_SECRET", "LOCAL_X_ACCESS_TOKEN", "LOCAL_X_ACCESS_TOKEN_SECRET"),
    ("X_NATHANPMYOUNG_*", "X_NATHANPMYOUNG_API_KEY", "X_NATHANPMYOUNG_API_KEY_SECRET", "X_NATHANPMYOUNG_ACCESS_TOKEN", "X_NATHANPMYOUNG_ACCESS_TOKEN_SECRET"),
]

for label, ck, cs, at, ats in cred_sets:
    print(f"\n=== {label} ===")
    if not all(os.environ.get(k) for k in (ck, cs, at, ats)):
        print("  missing one or more env vars; skipping")
        continue

    auth = OAuth1(os.environ[ck], os.environ[cs], os.environ[at], os.environ[ats])

    for tm in ("false", "true"):
        params = {"test_mode": tm, "max_results": "1", "note.fields": "id,info,status,scoring_status"}
        r = requests.get(URL, params=params, auth=auth, timeout=15)
        if r.ok:
            body = r.json()
            n = len((body.get("data") or []))
            print(f"  test_mode={tm}: HTTP {r.status_code} OK ({n} notes returned)")
        else:
            try:
                detail = r.json().get("detail", r.text)
            except Exception:
                detail = r.text
            print(f"  test_mode={tm}: HTTP {r.status_code} — {detail[:200]}")
