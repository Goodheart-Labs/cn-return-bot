"""Embed note texts with gemini-embedding-001, cached to embeddings.npy."""

import json
import os
import time
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

DIR = Path(__file__).parent
MODEL = "gemini-embedding-001"
BATCH_SIZE = 100
MAX_RETRIES = 5

notes = json.loads((DIR / "notes.json").read_text())
texts = [n["note_text"] for n in notes]
print(f"{len(texts)} notes to embed")

out_path = DIR / "embeddings.npy"
if out_path.exists():
    cached = np.load(out_path)
    if len(cached) == len(texts):
        print("embeddings.npy already complete, nothing to do")
        raise SystemExit(0)

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

embeddings = []
for start in range(0, len(texts), BATCH_SIZE):
    batch = texts[start : start + BATCH_SIZE]
    for attempt in range(MAX_RETRIES):
        try:
            result = client.models.embed_content(
                model=MODEL,
                contents=batch,
                config=types.EmbedContentConfig(task_type="CLUSTERING"),
            )
            break
        except Exception as e:
            wait = 2**attempt * 5
            print(f"batch {start}: {e} — retrying in {wait}s")
            time.sleep(wait)
    else:
        raise RuntimeError(f"batch {start} failed after {MAX_RETRIES} retries")
    embeddings.extend(e.values for e in result.embeddings)
    print(f"{len(embeddings)}/{len(texts)}")

arr = np.array(embeddings, dtype=np.float32)
np.save(out_path, arr)
print(f"wrote {out_path} shape={arr.shape}")
