"""One-off: manually set pipeline_state.writing_limit so prod can resume.

Background: writing_limit was last updated months ago (31) when X returned a
daily-limit error. Since then X allowed us to submit past 31 without
re-triggering the error, so the stored value drifted. The new bump-on-success
behavior keeps it fresh going forward, but right now the bot is stuck
producing 0 because submissions_24h (38) > stored writing_limit (31). Setting
this to 40 unblocks production immediately.
"""

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

NEW_WRITING_LIMIT = 40
KEY = "writing_limit"


def rest_request(method: str, path: str, *, body: dict | None = None, prefer: str | None = None) -> bytes:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def get_current_value() -> str | None:
    params = urllib.parse.urlencode({"key": f"eq.{KEY}", "select": "value,updated_at"})
    body = rest_request("GET", f"pipeline_state?{params}")
    rows = json.loads(body)
    return rows[0] if rows else None


def main() -> None:
    before = get_current_value()
    print(f"Before: {before}")

    rest_request(
        "POST",
        "pipeline_state",
        body={
            "key": KEY,
            "value": str(NEW_WRITING_LIMIT),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        prefer="resolution=merge-duplicates,return=representation",
    )

    after = get_current_value()
    print(f"After: {after}")


if __name__ == "__main__":
    main()
