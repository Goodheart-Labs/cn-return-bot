"""Verify the GA model id for gemini-3-pro against the live Generative Language API.

Lists every gemini-3* model the key can see, then does a 1-token generate call
against both `gemini-3-pro` (proposed GA id) and `gemini-3-pro-preview` (old id)
to confirm which one the API actually accepts.
"""

import json
import os
import urllib.error
import urllib.request

from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ["GEMINI_API_KEY"]
BASE = "https://generativelanguage.googleapis.com/v1beta"


def list_gemini3_models() -> list[str]:
    url = f"{BASE}/models?key={API_KEY}&pageSize=200"
    with urllib.request.urlopen(url) as resp:
        data = json.load(resp)
    names = [m["name"] for m in data.get("models", [])]
    return sorted(n for n in names if "gemini-3" in n)


def try_generate(model: str) -> str:
    url = f"{BASE}/models/{model}:generateContent?key={API_KEY}"
    body = json.dumps({"contents": [{"parts": [{"text": "ping"}]}]}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            json.load(resp)
        return "OK"
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:200]
        return f"{e.code} {detail}"


print("=== gemini-3* models visible to this key ===")
for name in list_gemini3_models():
    print(" ", name)

print("\n=== generateContent probes ===")
for model in ["gemini-3-pro", "gemini-3-pro-preview"]:
    print(f"  {model:24s} -> {try_generate(model)}")
