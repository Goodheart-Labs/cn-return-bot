"""Simplest possible request — just to see if Supabase responds at all."""

import os
import time
import urllib.request
import urllib.error

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))


def t(label, url):
    t0 = time.time()
    req = urllib.request.Request(
        url,
        headers={
            "apikey": os.environ["SUPABASE_SERVICE_KEY"],
            "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
            "Range": "0-0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read()
            print(f"{label}: ok in {time.time()-t0:.2f}s, status={r.status}, body={body[:200]!r}")
    except urllib.error.HTTPError as e:
        print(f"{label}: HTTP {e.code} in {time.time()-t0:.2f}s — {e.read().decode()[:300]}")
    except Exception as e:
        print(f"{label}: {type(e).__name__} in {time.time()-t0:.2f}s — {e}")


base = os.environ["SUPABASE_URL"]

t("notes (small table)", f"{base}/rest/v1/notes?select=note_id&limit=1")
t("pipeline_runs id only, no order, limit 1", f"{base}/rest/v1/pipeline_runs?select=id&limit=1")
t("bot_configs (tiny table)", f"{base}/rest/v1/bot_configs?select=*&limit=1")
