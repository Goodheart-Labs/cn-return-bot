"""
Call Claude Sonnet 4.6 via OpenRouter with the native web_search tool and ask
it to include full URL sources inline in the prose.
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

SYSTEM_PROMPT = (
    "When you use the web_search tool, cite the full source URL inline in your "
    "answer — write out the complete https://... link next to each claim it "
    "supports. Do not use footnote-style numbers or shortened domain names."
)

USER_PROMPT = (
    "Who won the most recent Formula 1 race? Give a short summary and include "
    "the full URL of each source inline next to the facts they support."
)


def main() -> None:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT},
        ],
        tools=[{"type": "web_search_20260209", "name": "web_search"}],
    )

    msg = response.choices[0].message
    print("=" * 60)
    print("ASSISTANT CONTENT")
    print("=" * 60)
    print(msg.content)

    print("\n" + "=" * 60)
    print("ANNOTATIONS (citations)")
    print("=" * 60)
    annotations = getattr(msg, "annotations", None)
    print(json.dumps(annotations, indent=2, default=str))

    print("\n" + "=" * 60)
    print("USAGE")
    print("=" * 60)
    print(json.dumps(response.usage.model_dump(), indent=2, default=str))


if __name__ == "__main__":
    main()
