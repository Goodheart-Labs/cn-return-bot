"""Investigate the mystery `ai-community-notes-writer-jim-2` key.

Goal: figure out (1) when it was created and what its metadata looks like,
(2) what it was used for on 2026-04-24 when it spent $425.

OpenRouter activity rows include `model`, `provider_name`, `requests`,
`prompt_tokens`, `completion_tokens` — so we can break down the $425.
"""

import json
import os
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

OPENROUTER_MGMT_KEY = os.environ["OPENROUTER_MGMT_KEY"]


def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://openrouter.ai/api/v1/{path}",
        headers={"Authorization": f"Bearer {OPENROUTER_MGMT_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def main():
    keys = api_get("keys")["data"]

    print("=" * 80)
    print("ALL KEYS ON THIS ACCOUNT (full metadata)")
    print("=" * 80)
    for key in sorted(keys, key=lambda k: k.get("created_at") or ""):
        print(json.dumps(key, indent=2, default=str))
        print("-" * 80)

    target = next(
        (k for k in keys if k["name"] == "ai-community-notes-writer-jim-2"), None
    )
    if target is None:
        print("\nKey 'ai-community-notes-writer-jim-2' not found")
        return

    print("\n" + "=" * 80)
    print(f"FULL ACTIVITY for ai-community-notes-writer-jim-2 (hash={target['hash']})")
    print("=" * 80)
    activity = api_get(f"activity?api_key_hash={target['hash']}")["data"]
    print(f"Got {len(activity)} activity rows total\n")

    # Daily totals
    daily: dict[str, float] = defaultdict(float)
    for row in activity:
        daily[row["date"][:10]] += row["usage"]
    print("Daily totals:")
    for day in sorted(daily):
        print(f"  {day}  ${daily[day]:>9.2f}")

    # April 24 deep dive
    print("\n" + "=" * 80)
    print("2026-04-24 — per-row breakdown")
    print("=" * 80)
    apr24 = [r for r in activity if r["date"].startswith("2026-04-24")]
    apr24.sort(key=lambda r: -r["usage"])
    total = sum(r["usage"] for r in apr24)
    print(f"{len(apr24)} rows summing to ${total:.2f}\n")
    for r in apr24:
        print(json.dumps(r, indent=2, default=str))
        print("-" * 40)


if __name__ == "__main__":
    main()
