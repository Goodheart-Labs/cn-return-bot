"""Print monthly OpenRouter spend for both API keys."""

import json
import os
import urllib.request

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

OPENROUTER_MGMT_KEY = os.environ["OPENROUTER_MGMT_KEY"]
KEY_NAMES = ["ai-community-notes-writer-jim", "ai-community-note-writer-2"]


def openrouter_keys():
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/keys",
        headers={"Authorization": f"Bearer {OPENROUTER_MGMT_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())["data"]


def main():
    keys = openrouter_keys()
    total = 0.0

    for name in KEY_NAMES:
        match = next((k for k in keys if k["name"] == name), None)
        if not match:
            print(f"{name}: NOT FOUND")
            continue
        monthly = match["usage_monthly"]
        total += monthly
        print(f"{name}:")
        print(f"  Monthly:  ${monthly:.2f}")
        print(f"  Weekly:   ${match['usage_weekly']:.2f}")
        print(f"  All-time: ${match['usage']:.2f}")
        print()

    print(f"Combined monthly: ${total:.2f}")


if __name__ == "__main__":
    main()
