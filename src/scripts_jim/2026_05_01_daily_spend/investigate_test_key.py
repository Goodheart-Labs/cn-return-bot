"""Look at the suspicious TEST key (created 2026-04-24 06:52, no spend limit, $137 usage)
and re-check jim-2 on 2026-04-29 / 04-30 to see if the pattern repeats.
"""

import json
import os
import urllib.request
from collections import defaultdict

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


def summarize_by_model(activity: list[dict], date_prefix: str) -> None:
    by_model: dict[str, dict] = defaultdict(lambda: {"usage": 0.0, "requests": 0})
    for r in activity:
        if not r["date"].startswith(date_prefix):
            continue
        m = r["model"]
        by_model[m]["usage"] += r["usage"]
        by_model[m]["requests"] += r["requests"]
    total = sum(v["usage"] for v in by_model.values())
    print(f"  total: ${total:.2f}")
    for m, v in sorted(by_model.items(), key=lambda kv: -kv[1]["usage"]):
        print(f"    {m:<55} ${v['usage']:>8.2f}  ({v['requests']:>6} requests)")


def main():
    keys = api_get("keys")["data"]

    test = next((k for k in keys if k["name"] == "TEST"), None)
    jim2 = next((k for k in keys if k["name"] == "ai-community-notes-writer-jim-2"), None)

    print("=" * 80)
    print("TEST key — daily and per-model")
    print("=" * 80)
    test_act = api_get(f"activity?api_key_hash={test['hash']}")["data"]
    days = sorted(set(r["date"][:10] for r in test_act))
    for d in days:
        print(f"\n[{d}]")
        summarize_by_model(test_act, d)

    print("\n" + "=" * 80)
    print("jim-2 key — daily and per-model")
    print("=" * 80)
    jim2_act = api_get(f"activity?api_key_hash={jim2['hash']}")["data"]
    days = sorted(set(r["date"][:10] for r in jim2_act))
    for d in days:
        print(f"\n[{d}]")
        summarize_by_model(jim2_act, d)


if __name__ == "__main__":
    main()
