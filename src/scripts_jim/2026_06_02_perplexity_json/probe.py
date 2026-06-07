"""Probe how to get parseable JSON out of Perplexity sonar via OpenRouter.

Context: we just turned on provider.require_parameters=true globally. Sonar's
bundled search sends response_format=json_schema(strict), and OpenRouter now
404s with "No endpoints found that can handle the requested parameters" because
no Perplexity endpoint advertises strict json_schema support.

This compares routing/parse outcomes across strategies so we can pick the right
fix for searchWithSonarBundled.
"""

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

MODEL = "perplexity/sonar-reasoning-pro"

SYSTEM = (
    "You are a research agent. Investigate the post for factual errors using web search."
)
USER = "The Eiffel Tower is located in Berlin, Germany. Is this correct?"

JSON_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "simple_bot_search",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "findings": {"type": "string"},
                "correction_needed": {"type": "boolean"},
            },
            "required": ["findings", "correction_needed"],
            "additionalProperties": False,
        },
    },
}

PROMPTED_JSON = (
    'Respond with strict JSON only, no prose, no markdown fences, matching: '
    '{ "findings": string, "correction_needed": boolean }'
)


def client() -> OpenAI:
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.getenv("OPENROUTER_API_KEY"),
    )


def run(label: str, **kwargs) -> None:
    print(f"\n{'=' * 70}\n{label}\n{'=' * 70}")
    try:
        resp = client().chat.completions.create(model=MODEL, **kwargs)
    except Exception as e:  # noqa: BLE001
        print(f"ERROR {type(e).__name__}: {e}")
        return
    msg = resp.choices[0].message
    content = msg.content or ""
    print(f"provider/finish: {getattr(resp, 'provider', '?')} / {resp.choices[0].finish_reason}")
    print(f"raw content (first 400):\n{content[:400]}")
    cleaned = content.strip()
    # Sonar reasoning models emit <think>...</think> before the answer.
    if "</think>" in cleaned:
        cleaned = cleaned.split("</think>", 1)[1].strip()
    cleaned = cleaned.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        parsed = json.loads(cleaned)
        print(f"PARSED OK -> keys={list(parsed.keys())}")
    except Exception as e:  # noqa: BLE001
        print(f"PARSE FAILED: {e}\ncleaned (first 400):\n{cleaned[:400]}")


def main() -> None:
    base_msgs = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": USER},
    ]

    # A) Current broken path: strict json_schema + require_parameters -> expect 404.
    run(
        "A) json_schema strict + require_parameters (CURRENT, expect 404)",
        messages=base_msgs,
        response_format=JSON_SCHEMA,
        extra_body={"provider": {"require_parameters": True}},
    )

    # B) Prompted JSON, no response_format, no require_parameters (proposed fix).
    run(
        "B) prompted JSON, no response_format (proposed fix)",
        messages=[
            {"role": "system", "content": f"{SYSTEM}\n\n{PROMPTED_JSON}"},
            {"role": "user", "content": USER},
        ],
    )

    # C) response_format=json_object (not schema) + require_parameters.
    run(
        "C) json_object + require_parameters",
        messages=base_msgs,
        response_format={"type": "json_object"},
        extra_body={"provider": {"require_parameters": True}},
    )

    # D) json_schema strict WITHOUT require_parameters (does Sonar honor it at all?).
    run(
        "D) json_schema strict, NO require_parameters",
        messages=base_msgs,
        response_format=JSON_SCHEMA,
    )

    # E) prompted JSON + require_parameters, NO response_format.
    # If this routes, the fix is purely in searchDispatch (drop response_format
    # for perplexity); llm.ts can keep injecting require_parameters globally.
    run(
        "E) prompted JSON + require_parameters, NO response_format",
        messages=[
            {"role": "system", "content": f"{SYSTEM}\n\n{PROMPTED_JSON}"},
            {"role": "user", "content": USER},
        ],
        extra_body={"provider": {"require_parameters": True}},
    )


if __name__ == "__main__":
    main()
