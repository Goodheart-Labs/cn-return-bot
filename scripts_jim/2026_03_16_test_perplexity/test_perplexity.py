import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def main():
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1/",
        api_key=os.getenv("OPENROUTER_API_KEY"),
    )
    response = client.chat.completions.create(
        model="perplexity/sonar",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "battle of waterloo"},
                ],
            },
        ],
    )
    print(json.dumps(response.to_dict(), indent=2))


if __name__ == "__main__":
    main()