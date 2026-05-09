"""Tiny Supabase REST helper. Same shape as the candidate_rate_drop folder's
copy — duplicated rather than imported because each scripts_jim subfolder is
meant to be self-contained."""

import json
import os
import urllib.parse
import urllib.request
from typing import Any

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

PAGE_SIZE = 1000


def _request(path: str, params: dict[str, str], range_header: str | None = None) -> bytes:
    url = f"{SUPABASE_URL}/rest/v1/{path}?{urllib.parse.urlencode(params)}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    if range_header is not None:
        headers["Range"] = range_header
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def fetch_all(path: str, params: dict[str, str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = json.loads(_request(path, params, range_header=f"{offset}-{offset + PAGE_SIZE - 1}"))
        out.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return out
