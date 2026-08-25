# /// script
# requires-python = ">=3.10"
# dependencies = ["requests", "python-dotenv"]
# ///
"""Step 3: probe the two spend-capped providers the outage traced back to.

- Brave Search API: one real query. A 402 USAGE_LIMIT_EXCEEDED means the paid
  fallback that carries CI search is dead until the monthly reset.
- OpenRouter key endpoint: prints the key's monthly limit, usage so far this
  month, and what remains. This is the limit that 403'd every LLM call on
  Aug 21-22.

Run from the workspace root: uv run src/scripts_jim/2026_08_25_pipeline_note_yield/check_search_providers.py
"""

import json
import os

import requests
from dotenv import load_dotenv

load_dotenv()


def check_brave() -> None:
    print("## Brave Search API")
    r = requests.get(
        "https://api.search.brave.com/res/v1/web/search",
        params={"q": "USMCA Article 32.10", "count": 3},
        headers={"X-Subscription-Token": os.environ["BRAVE_API_KEY"], "Accept": "application/json"},
        timeout=20,
    )
    if r.status_code == 200:
        n = len(r.json().get("web", {}).get("results", []))
        print(f"OK: HTTP 200, {n} results")
    else:
        print(f"HTTP {r.status_code}: {json.dumps(r.json().get('error', {}), indent=2)}")


def check_openrouter() -> None:
    print("\n## OpenRouter key")
    r = requests.get(
        "https://openrouter.ai/api/v1/key",
        headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
        timeout=20,
    )
    d = r.json()["data"]
    print(f"limit: ${d['limit']} per {d['limit_reset']}")
    print(f"used this month: ${d['usage_monthly']:.2f}")
    print(f"remaining: ${d['limit_remaining']:.2f}")


if __name__ == "__main__":
    check_brave()
    check_openrouter()
