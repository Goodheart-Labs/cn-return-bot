"""Tiny Supabase REST helper. Self-contained per scripts_jim convention."""

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


def fetch_page(path: str, params: dict[str, str], offset: int) -> list[dict[str, Any]]:
    page = json.loads(_request(path, params, range_header=f"{offset}-{offset + PAGE_SIZE - 1}"))
    return page
