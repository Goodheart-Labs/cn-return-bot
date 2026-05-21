"""
Probe the xAI endpoint to diagnose the "Forbidden" we see in production from
`fetchTweetComments` (src/pipeline/input/comments.ts).

Hits three things in order:
  1. /v1/api-key  -- is the key valid at all?
  2. /v1/models   -- which models is the key entitled to?
  3. /v1/responses with the `grok-4-fast` model + `x_search` Live Search tool
     -- this is what the bot actually does.

Run from repo root:
    uv run src/scripts_jim/2026_05_20_xai_forbidden_probe/probe.py
"""

from __future__ import annotations

import json
import os
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ.get("XAI_API_KEY")
BASE_URL = "https://api.x.ai/v1"
GROK_MODEL = "grok-4-fast"  # mirrors src/pipeline/cost-tracking/pricing.ts


def header(label: str) -> None:
    print(f"\n=== {label} ===")


def show(resp: httpx.Response) -> None:
    print(f"HTTP {resp.status_code}")
    body = resp.text
    if len(body) > 1200:
        body = body[:1200] + f"... [truncated, total {len(resp.text)} chars]"
    print(body)


def main() -> int:
    if not API_KEY:
        print("XAI_API_KEY is not set in the environment / .env -- nothing to test.")
        return 2

    masked = f"{API_KEY[:6]}...{API_KEY[-4:]} (len={len(API_KEY)})"
    print(f"Using XAI_API_KEY: {masked}")

    headers = {"Authorization": f"Bearer {API_KEY}"}

    with httpx.Client(timeout=30.0) as client:
        header("1. GET /v1/api-key  -- is the key valid?")
        try:
            r = client.get(f"{BASE_URL}/api-key", headers=headers)
            show(r)
        except Exception as e:
            print(f"request failed: {e}")

        header("2. GET /v1/models  -- which models can this key see?")
        try:
            r = client.get(f"{BASE_URL}/models", headers=headers)
            show(r)
        except Exception as e:
            print(f"request failed: {e}")

        header(f"3. POST /v1/responses  -- {GROK_MODEL} + x_search (mirrors prod)")
        payload = {
            "model": GROK_MODEL,
            "input": "Say hi in three words.",
            "tools": [{"type": "x_search"}],
        }
        try:
            r = client.post(
                f"{BASE_URL}/responses",
                headers={**headers, "Content-Type": "application/json"},
                json=payload,
            )
            show(r)
        except Exception as e:
            print(f"request failed: {e}")

        header(f"4. POST /v1/responses  -- {GROK_MODEL} no tools (sanity)")
        payload_notools = {
            "model": GROK_MODEL,
            "input": "Say hi in three words.",
        }
        try:
            r = client.post(
                f"{BASE_URL}/responses",
                headers={**headers, "Content-Type": "application/json"},
                json=payload_notools,
            )
            show(r)
        except Exception as e:
            print(f"request failed: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
