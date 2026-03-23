#!/usr/bin/env python3
"""
Tag Twitter video dataset with TikTok-likeness scores and content tags using Gemini 3 Flash.

Usage:
    pip install requests
    export OPENROUTER_API_KEY=your_key
    python scripts_jim/2026_03_22_twitter_video_dataset/tag_videos.py

Requires: yt-dlp installed and available on PATH.
Supports resume: re-run to pick up where you left off.
"""

import csv
import json
import os
import sys
import base64
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

# --- Configuration ---
MODEL = "google/gemini-3-flash-preview"
MAX_WORKERS = 5
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 5

SCRIPT_DIR = Path(__file__).parent
INPUT_CSV = SCRIPT_DIR / "video_dataset.csv"
OUTPUT_CSV = SCRIPT_DIR / "video_dataset_tagged.csv"

OUTPUT_FIELDS = [
    "url", "needs_note", "ground_truth_note", "tweet_text",
    "tiktok_likeness", "tiktok_reasoning", "tags",
]

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    print("Error: Set OPENROUTER_API_KEY environment variable")
    sys.exit(1)

# --- Shared state ---
tag_lock = threading.Lock()
tag_counts: dict[str, int] = {}

write_lock = threading.Lock()
progress_lock = threading.Lock()
processed_count = 0
total_count = 0


def get_tag_context() -> str:
    with tag_lock:
        if not tag_counts:
            return "No tags assigned yet. Create appropriate tags for this video."
        sorted_tags = sorted(tag_counts.items(), key=lambda x: -x[1])
        if len(sorted_tags) > 80:
            sorted_tags = sorted_tags[:80]
        lines = [f"  {tag} ({count})" for tag, count in sorted_tags]
        return (
            "Existing tags (reuse when applicable, but create new ones if needed):\n"
            + "\n".join(lines)
        )


def update_tags(new_tags: list[str]):
    with tag_lock:
        for tag in new_tags:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1


def normalize_tag(tag: str) -> str:
    return tag.strip().lower().replace(" ", "_").replace("-", "_")


def download_video(url: str, output_path: str) -> bool:
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "-f", "best[ext=mp4][height<=720]/best[ext=mp4]/best",
                "--no-playlist",
                "--socket-timeout", "30",
                "-o", output_path,
                "--quiet",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        return result.returncode == 0 and os.path.exists(output_path)
    except subprocess.TimeoutExpired:
        return False


def call_gemini(video_b64: str, prompt: str) -> dict | None:
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": MODEL,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "video_url",
                                    "video_url": {
                                        "url": f"data:video/mp4;base64,{video_b64}",
                                    },
                                },
                                {"type": "text", "text": prompt},
                            ],
                        }
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.3,
                },
                timeout=180,
            )

            if resp.status_code == 429:
                wait = RETRY_BACKOFF_BASE * (2 ** attempt)
                print(f"  Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue

            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            return json.loads(content)

        except (requests.RequestException, json.JSONDecodeError, KeyError, IndexError) as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_BASE * (2 ** attempt))
            else:
                print(f"  API error after {MAX_RETRIES} attempts: {e}")
                return None

    return None


def build_prompt(tweet_text: str, ground_truth_note: str, tag_context: str) -> str:
    note_section = ""
    if ground_truth_note:
        note_section = f"\n**Community note:** {ground_truth_note}\n"

    return f"""You are analyzing a tweet with a video from Twitter/X.

## Tweet Information
**Tweet text:** {tweet_text}
{note_section}
## Tasks

### 1. TikTok-Likeness Score (1-5)

Rate how "TikTok-like" this video+text combination is:

1 = Traditional content where text is primary (news segments, interviews, C-SPAN clips with lengthy analysis tweets — video is supplementary)
2 = Traditional media shared on social media (TV clips, dashcam/CCTV footage, press conferences with descriptive tweet adding essential context)
3 = Mixed — could exist on either platform (some visual engagement, tweet adds meaningful but not essential context)
4 = TikTok-style but with Twitter-specific presentation (engaging video where tweet text provides context that on TikTok would be subtitles/voiceover/on-screen text)
5 = Pure TikTok-native content (video IS the content — visually engaging, minimal/reactionary tweet text, could go on TikTok as-is)

Key factors:
- Is the video the primary content or supplementary to text?
- Visual style (vertical, effects, burned-in captions, quick cuts)
- Would it work on TikTok with minimal changes?
- Content that is similar to TikTok but uses tweet text instead of in-video text still counts as TikTok-like (score 4)

### 2. Content Tags

Assign descriptive tags. Rules:
- Lowercase with underscores: ai_generated NOT AI-Generated
- Use both general tags: e.g. war_coverage and specific tags e.g. india_pakistan
- Reuse existing tags when they fit

{tag_context}

## Response Format (JSON only, no other text)
{{"tiktok_likeness": <1-5 integer>, "tiktok_reasoning": "<1-2 sentences>", "tags": ["tag1", "tag2"]}}"""


def process_row(row: dict) -> dict:
    global processed_count
    url = row["url"]
    tweet_text = row.get("tweet_text", "")
    ground_truth_note = row.get("ground_truth_note", "")

    result = {
        **row,
        "tiktok_likeness": "",
        "tiktok_reasoning": "",
        "tags": "",
        "error": "",
    }

    # Download video to temp dir
    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, "video.mp4")

        if not download_video(url, video_path):
            result["error"] = "download_failed"
            with progress_lock:
                processed_count += 1
                print(f"[{processed_count}/{total_count}] SKIP (download failed): {url}")
            return result

        with open(video_path, "rb") as f:
            video_b64 = base64.b64encode(f.read()).decode()

    # Build prompt with current tag context
    tag_context = get_tag_context()
    prompt = build_prompt(tweet_text, ground_truth_note, tag_context)

    # Call Gemini
    response = call_gemini(video_b64, prompt)

    if response is None:
        result["error"] = "api_failed"
        with progress_lock:
            processed_count += 1
            print(f"[{processed_count}/{total_count}] SKIP (API failed): {url}")
        return result

    # Extract results
    result["tiktok_likeness"] = response.get("tiktok_likeness", "")
    result["tiktok_reasoning"] = response.get("tiktok_reasoning", "")
    tags = response.get("tags", [])
    tags = [normalize_tag(t) for t in tags if t.strip()]
    result["tags"] = "|".join(tags)

    update_tags(tags)

    with progress_lock:
        processed_count += 1
        print(
            f"[{processed_count}/{total_count}] "
            f"tiktok={result['tiktok_likeness']} tags={result['tags']}: {url}"
        )

    return result


def load_processed(output_path: Path) -> set[str]:
    """Load already-processed URLs and their tag counts for resume."""
    if not output_path.exists():
        return set()

    processed = set()
    with open(output_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("url"):
                processed.add(row["url"])
            if row.get("tags"):
                for tag in row["tags"].split("|"):
                    tag = tag.strip()
                    if tag:
                        tag_counts[tag] = tag_counts.get(tag, 0) + 1
    return processed


def main():
    global total_count

    with open(INPUT_CSV) as f:
        all_rows = list(csv.DictReader(f))

    already_processed = load_processed(OUTPUT_CSV)
    rows_to_process = [r for r in all_rows if r["url"] not in already_processed]
    total_count = len(rows_to_process)

    if not rows_to_process:
        print("All rows already processed!")
        return

    print(f"Processing {total_count} rows ({len(already_processed)} already done)")
    print(f"Model: {MODEL}")
    print(f"Workers: {MAX_WORKERS}")
    print(f"Output: {OUTPUT_CSV}")
    if tag_counts:
        print(f"Resumed with {len(tag_counts)} existing tags")
    print()

    write_header = not OUTPUT_CSV.exists() or len(already_processed) == 0

    with open(OUTPUT_CSV, "a", newline="") as outfile:
        writer = csv.DictWriter(outfile, fieldnames=OUTPUT_FIELDS)
        if write_header:
            writer.writeheader()
            outfile.flush()

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {
                executor.submit(process_row, row): row for row in rows_to_process
            }

            for future in as_completed(futures):
                try:
                    result = future.result()
                    if not result.get("error"):
                        with write_lock:
                            writer.writerow({k: result.get(k, "") for k in OUTPUT_FIELDS})
                            outfile.flush()
                except Exception as e:
                    row = futures[future]
                    print(f"Unexpected error for {row['url']}: {e}")

    print(f"\nDone! Results: {OUTPUT_CSV}")
    print(f"Tags ({len(tag_counts)} unique):")
    for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1])[:20]:
        print(f"  {tag}: {count}")


if __name__ == "__main__":
    main()
