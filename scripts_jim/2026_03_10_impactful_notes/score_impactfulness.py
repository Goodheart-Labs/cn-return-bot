"""
Score community notes by impactfulness using Claude 4.6 via OpenRouter.
Processes rows with 10 parallel threads, saves intermediate results,
and outputs a sorted CSV at the end.

Usage:
    python score_impactfulness.py           # Process first 500 rows
    python score_impactfulness.py 1000      # Process first 1000 rows
    python score_impactfulness.py all       # Process all rows

Resumable: already-scored rows are cached in impactfulness_results/ and skipped.
"""

import argparse
import csv
import json
import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from dotenv import load_dotenv

# Load .env.local from project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    sys.exit("Error: OPENROUTER_API_KEY not set in .env.local")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "anthropic/claude-opus-4-6"
MAX_THREADS = 10
MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 2

INPUT_CSV = Path(__file__).parent / "helpful_cn_notes.csv"
INTERMEDIATE_DIR = Path(__file__).parent / "impactfulness_results"
OUTPUT_CSV = Path(__file__).parent / "helpful_cn_notes_sorted_by_impact.csv"

SYSTEM_PROMPT = """You are an expert analyst evaluating community notes on social media posts.

You will be given a tweet and a community note that was rated helpful (meaning the note is almost certainly true/accurate).

Score the note's IMPACTFULNESS from 0 to 100 based on:
1. Topic importance: Is this about politics, public health, safety, human/animal welfare, or other high-stakes topics?
2. Deception severity: How many people might have believed the misleading tweet without the note?
3. Real-world consequences: How much harm could result if people believe the tweet? How many human or animal lives are affected?
4. Corrective value: How much does the world improve now that this community note is shown?

Low scores (0-20): Trivial corrections, entertainment gossip, minor factual errors with no real consequences.
Medium scores (30-60): Moderately important topics, some potential for real harm if uncorrected.
High scores (70-100): Critical public health/safety, political misinformation affecting elections/policy, issues affecting many lives.

Respond with ONLY a JSON object: {"score": <integer 0-100>, "reasoning": "<one sentence>"}"""

# Lock for thread-safe printing
print_lock = threading.Lock()
progress_counter = {"done": 0, "total": 0}


def call_openrouter(tweet_text: str, note_text: str) -> dict:
    """Call OpenRouter API with retry and backoff for rate limits."""
    user_message = f"TWEET:\n{tweet_text}\n\nCOMMUNITY NOTE:\n{note_text}"

    payload = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "max_tokens": 200,
        "temperature": 0.0,
    }).encode()

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    backoff = INITIAL_BACKOFF_SECONDS
    for attempt in range(MAX_RETRIES):
        try:
            req = Request(OPENROUTER_URL, data=payload, headers=headers, method="POST")
            with urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read())
            content = body["choices"][0]["message"]["content"].strip()
            # Parse JSON from response (handle markdown code blocks)
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            result = json.loads(content)
            return result
        except HTTPError as e:
            if e.code == 429 or e.code >= 500:
                with print_lock:
                    print(f"  Rate limit/server error (HTTP {e.code}), retrying in {backoff}s...")
                time.sleep(backoff)
                backoff *= 2
            else:
                raise
        except (json.JSONDecodeError, KeyError, IndexError) as e:
            if attempt < MAX_RETRIES - 1:
                with print_lock:
                    print(f"  Parse error ({e}), retrying in {backoff}s...")
                time.sleep(backoff)
                backoff *= 2
            else:
                raise

    raise RuntimeError(f"Failed after {MAX_RETRIES} retries")


def process_row(row_idx: int, row: dict) -> dict:
    """Process a single row: call LLM and return result."""
    result_file = INTERMEDIATE_DIR / f"row_{row_idx:05d}.json"

    # Skip if already processed
    if result_file.exists():
        with open(result_file) as f:
            cached = json.load(f)
        with print_lock:
            progress_counter["done"] += 1
            print(f"  [{progress_counter['done']}/{progress_counter['total']}] Row {row_idx} (cached, score={cached.get('score', '?')})")
        return cached

    tweet_text = row.get("tweet_text", "")
    note_text = row.get("note_text", "")

    try:
        llm_result = call_openrouter(tweet_text, note_text)
        score = int(llm_result.get("score", 0))
        reasoning = llm_result.get("reasoning", "")
    except Exception as e:
        score = -1
        reasoning = f"ERROR: {e}"

    result = {
        "row_idx": row_idx,
        "tweet_text": tweet_text,
        "note_text": note_text,
        "has_photo": row.get("has_photo", ""),
        "has_video": row.get("has_video", ""),
        "score": score,
        "reasoning": reasoning,
    }

    with open(result_file, "w") as f:
        json.dump(result, f, ensure_ascii=False)

    with print_lock:
        progress_counter["done"] += 1
        print(f"  [{progress_counter['done']}/{progress_counter['total']}] Row {row_idx} → score={score}")

    return result


def main():
    INTERMEDIATE_DIR.mkdir(exist_ok=True)

    # Read input CSV
    print(f"Reading {INPUT_CSV}...")
    with open(INPUT_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    total = len(rows)
    progress_counter["total"] = total
    print(f"Found {total} rows. Processing with {MAX_THREADS} threads...\n")

    results = []

    with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
        futures = {
            executor.submit(process_row, idx, row): idx
            for idx, row in enumerate(rows)
        }
        for future in as_completed(futures):
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                idx = futures[future]
                print(f"  Row {idx} failed: {e}")
                results.append({
                    "row_idx": idx,
                    "tweet_text": rows[idx].get("tweet_text", ""),
                    "note_text": rows[idx].get("note_text", ""),
                    "has_photo": rows[idx].get("has_photo", ""),
                    "has_video": rows[idx].get("has_video", ""),
                    "score": -1,
                    "reasoning": f"ERROR: {e}",
                })

    # Sort by score descending
    results.sort(key=lambda r: r["score"], reverse=True)

    # Write sorted output CSV
    print(f"\nWriting sorted results to {OUTPUT_CSV}...")
    fieldnames = ["row_idx", "score", "reasoning", "tweet_text", "note_text", "has_photo", "has_video"]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    # Summary stats
    valid_scores = [r["score"] for r in results if r["score"] >= 0]
    errors = [r for r in results if r["score"] < 0]
    print(f"\nDone! {len(valid_scores)} scored, {len(errors)} errors.")
    if valid_scores:
        print(f"Score range: {min(valid_scores)}-{max(valid_scores)}, mean={sum(valid_scores)/len(valid_scores):.1f}")
    print(f"Output: {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
