"""Minimal Supabase PostgREST helper shared by this investigation's scripts."""

import json
import os
import urllib.parse
import urllib.request

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
PAGE_SIZE = 1000


def rest_get(table, params, range_header=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{urllib.parse.urlencode(params)}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    }
    if range_header:
        headers["Range"] = range_header
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
        return json.loads(r.read())


def fetch_all(table, params, order_col="id"):
    """Paginate past the 1000-row cap using keyset pagination on order_col."""
    rows = []
    last = None
    while True:
        page_params = dict(params)
        page_params["order"] = f"{order_col}.asc"
        page_params["limit"] = str(PAGE_SIZE)
        if last is not None:
            page_params[order_col] = f"gt.{last}"
        page = rest_get(table, page_params)
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        last = page[-1][order_col]
