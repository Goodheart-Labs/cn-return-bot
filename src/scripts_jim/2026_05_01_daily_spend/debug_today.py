"""Try various endpoints/params to find today's spend granularly."""

import json
import os
import urllib.request

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))
OPENROUTER_MGMT_KEY = os.environ["OPENROUTER_MGMT_KEY"]


def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://openrouter.ai/api/v1/{path}",
        headers={"Authorization": f"Bearer {OPENROUTER_MGMT_KEY}"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}


def main():
    keys = api_get("keys")["data"]
    h = next(k for k in keys if k["name"] == "ai-community-note-writer-2")["hash"]

    print("== activity?api_key_hash=... (default) ==")
    a = api_get(f"activity?api_key_hash={h}")
    if "data" in a:
        dates = sorted({r["date"][:10] for r in a["data"]})
        print(f"rows={len(a['data'])} earliest={dates[0]} latest={dates[-1]}")

    print("\n== activity?api_key_hash=...&date=2026-05-01 ==")
    print(json.dumps(api_get(f"activity?api_key_hash={h}&date=2026-05-01"), indent=2)[:1000])

    print("\n== activity (no key filter) ==")
    a = api_get("activity")
    if "data" in a:
        dates = sorted({r["date"][:10] for r in a["data"]})
        print(f"rows={len(a['data'])} earliest={dates[0]} latest={dates[-1]}")

    print("\n== generation listing? credits? ==")
    print("credits:", json.dumps(api_get("credits"), indent=2)[:500])


if __name__ == "__main__":
    main()
