"""Embed every tweet in the dataset, so the filter can look up similar earlier tweets (GOO-835).

An embedding is a vector that a model computes for a text, so that texts about
the same thing get nearby vectors. We embed the tweet's text together with the
text of the tweet it quotes or replies to, with OpenAI's text-embedding-3-small
through OpenRouter. That costs about $0.02 per million tokens, so all 36,000
tweets cost about 15 cents.

Run from the worktree root:
  uv run --with pandas --with pyarrow --with httpx --with python-dotenv src/scripts_jim/2026_11_20_tweet_note_prefilter/embed_tweets.py
"""

import asyncio
import os
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
from dotenv import load_dotenv

DATA_DIR = Path("/home/jim/dev/data/goo-835")
EMBEDDING_MODEL = "openai/text-embedding-3-small"
BATCH_SIZE = 200
CONCURRENCY = 6
MAX_CHARS = 2000


def embedding_text(row) -> str:
    referenced = row["referenced_tweet_data"]
    referenced_text = referenced.get("text", "") if isinstance(referenced, dict) else ""
    return f"{row['text'] or ''}\n\n{referenced_text}".strip()[:MAX_CHARS] or "(empty)"


async def embed_batch(client: httpx.AsyncClient, texts: list[str], semaphore: asyncio.Semaphore) -> list[list[float]]:
    async with semaphore:
        for attempt in range(5):
            response = await client.post("https://openrouter.ai/api/v1/embeddings", json={"model": EMBEDDING_MODEL, "input": texts})
            if response.status_code == 200:
                return [item["embedding"] for item in sorted(response.json()["data"], key=lambda item: item["index"])]
            await asyncio.sleep(2 ** attempt)
        response.raise_for_status()


async def main() -> None:
    load_dotenv(".env")
    df = pd.read_parquet(DATA_DIR / "dataset.parquet")
    texts = [embedding_text(row) for _, row in df.iterrows()]
    headers = {"Authorization": f"Bearer {os.environ['OPENROUTER_TESTING_KEY']}"}
    semaphore = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient(headers=headers, timeout=120) as client:
        batches = [texts[i:i + BATCH_SIZE] for i in range(0, len(texts), BATCH_SIZE)]
        results = await asyncio.gather(*(embed_batch(client, batch, semaphore) for batch in batches))
    vectors = np.array([vector for batch in results for vector in batch], dtype=np.float32)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    np.save(DATA_DIR / "embeddings.npy", vectors)
    df[["tweet_id"]].to_parquet(DATA_DIR / "embeddings_ids.parquet")
    print(vectors.shape)


asyncio.run(main())
