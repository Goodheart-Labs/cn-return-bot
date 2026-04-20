"""
Test whether Claude's native web_fetch and web_search tools work through OpenRouter.

Key question: Does OpenRouter execute them server-side and return results inline,
or do they come back as tool_calls that need local handling?
"""

import json
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
)

MODEL = "anthropic/claude-sonnet-4.6"


def test_web_fetch():
    print("=" * 60)
    print("TEST: web_fetch native tool (force Anthropic provider)")
    print("=" * 60)

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "user", "content": "Fetch https://httpbin.org/get and tell me what the response contains."},
        ],
        tools=[
            {"type": "web_fetch_20250305", "name": "web_fetch"},
        ],
        extra_body={"provider": {"order": ["Anthropic"], "allow_fallbacks": False}},
    )

    dump_response("web_fetch", response)


def test_web_search():
    print("=" * 60)
    print("TEST: web_search native tool")
    print("=" * 60)

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "user", "content": "What is the current population of Tokyo?"},
        ],
        tools=[
            {"type": "web_search_20260209", "name": "web_search"},
        ],
    )

    dump_response("web_search", response)


def dump_response(label: str, response):
    print(f"\n--- {label} raw response ---")
    raw = response.model_dump()
    print(json.dumps(raw, indent=2, default=str))

    msg = response.choices[0].message
    print(f"\n--- {label} message ---")
    print(f"role: {msg.role}")
    print(f"content: {msg.content[:500] if msg.content else None}")
    print(f"tool_calls: {msg.tool_calls}")
    print(f"annotations: {getattr(msg, 'annotations', None)}")

    # Check for any extra fields OpenRouter might add
    raw_msg = raw["choices"][0]["message"]
    known_keys = {"role", "content", "tool_calls", "refusal", "annotations", "function_call", "audio"}
    extra = set(raw_msg.keys()) - known_keys
    if extra:
        print(f"EXTRA message fields: {extra}")
        for k in extra:
            print(f"  {k}: {json.dumps(raw_msg[k], indent=2, default=str)[:500]}")

    print()


if __name__ == "__main__":
    test_web_fetch()
    test_web_search()
