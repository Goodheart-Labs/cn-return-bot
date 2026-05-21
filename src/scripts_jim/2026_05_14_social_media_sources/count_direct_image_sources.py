"""Count cited sources whose URL ends in a direct-image extension across
recent simple-bot runs. Quick sanity check before removing the direct-image
branch from the source verifier.
"""

import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from _supabase import PAGE_SIZE, fetch_page

LOOKBACK_DAYS = 30
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".avif")


def extract_sources(logs: dict | None) -> list[str]:
    if not logs:
        return []
    writer = (((logs.get("simpleBot") or {}).get("writer") or {}).get("attempts")) or {}
    attempts = writer.values() if isinstance(writer, dict) else writer
    for attempt in attempts:
        resp = (attempt or {}).get("response") or {}
        srcs = resp.get("sources") or []
        if srcs:
            return [s for s in srcs if isinstance(s, str)]
    return []


def main() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    params = {
        "bot_name": "eq.simple-bot",
        "created_at": f"gte.{cutoff}",
        "note_text": "not.is.null",
        "select": "id,logs",
        "order": "created_at.desc",
    }
    offset = 0
    total_runs = 0
    runs_with_image_src = 0
    total_image_urls = 0
    by_ext: Counter = Counter()
    examples: list[str] = []
    while True:
        page = fetch_page("pipeline_runs", params, offset)
        if not page:
            break
        for row in page:
            total_runs += 1
            srcs = extract_sources(row.get("logs"))
            hits = [s for s in srcs if urlparse(s).path.lower().endswith(IMAGE_EXTS)]
            if hits:
                runs_with_image_src += 1
                total_image_urls += len(hits)
                for s in hits:
                    ext = "." + urlparse(s).path.lower().rsplit(".", 1)[-1]
                    by_ext[ext] += 1
                    if len(examples) < 8:
                        examples.append(s)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    print(f"Scanned {total_runs} simple-bot runs in the last {LOOKBACK_DAYS} days.")
    print(f"  Runs with at least one direct-image-URL source: {runs_with_image_src}")
    print(f"  Total direct-image-URL sources: {total_image_urls}")
    print(f"  By extension: {dict(by_ext)}")
    if examples:
        print("\n  First few examples:")
        for s in examples:
            print(f"    {s}")


if __name__ == "__main__":
    main()
