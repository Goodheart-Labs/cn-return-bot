"""Find ~10 examples of simple-bot notes that cited a non-X social-media URL.

We're scoping the verifier's media-source A/B test and want a feel for what
social-media URLs the writer actually emits as sources. Source URLs are
stored under `pipeline_runs.logs->simpleBot->writer->attempts->{n}->response->sources`.

Output:
  - prints the first N matching examples to stdout
  - writes `social_source_examples.json` next to the script for re-reading
"""

import json
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from _supabase import PAGE_SIZE, fetch_page

LOOKBACK_DAYS = 30
TARGET_EXAMPLES = 10
MAX_ROWS_TO_SCAN = 5000
# Optional: restrict to one simple-bot search variant (e.g. "sonnet46-native"). None = all variants.
SEARCH_MODEL_VARIANT: str | None = "sonnet46-native"

SOCIAL_HOSTS = {
    "youtube.com", "youtu.be",
    "tiktok.com",
    "instagram.com",
    "facebook.com", "fb.watch",
    "reddit.com", "redd.it",
    "twitch.tv",
    "vimeo.com",
    "dailymotion.com",
    "rumble.com",
    "threads.net",
    "linkedin.com",
    "tumblr.com",
}


def hostname(url: str) -> str | None:
    try:
        h = urlparse(url).hostname or ""
        return h.lower().lstrip(".").removeprefix("www.")
    except Exception:
        return None


def is_social(url: str) -> str | None:
    h = hostname(url)
    if not h:
        return None
    for needle in SOCIAL_HOSTS:
        if h == needle or h.endswith(f".{needle}"):
            return needle
    return None


def extract_sources(logs: dict | None) -> list[str]:
    """Sources sit at logs.simpleBot.writer.attempts[n].response.sources.
    Attempts is an ordered dict-or-list depending on how tweetLog dumps; the
    writer only retries on length overflow, so attempt 0 is the live one in
    almost every case. Defensive walk handles both shapes."""
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
        "select": "id,tweet_id,created_at,note_text,outcome,ab_test_picks,logs",
        "order": "created_at.desc",
    }
    if SEARCH_MODEL_VARIANT:
        params["ab_test_picks"] = f'cs.{{"simple_bot_search":"{SEARCH_MODEL_VARIANT}"}}'

    examples: list[dict] = []
    scanned = 0
    offset = 0

    while len(examples) < TARGET_EXAMPLES and scanned < MAX_ROWS_TO_SCAN:
        page = fetch_page("pipeline_runs", params, offset)
        if not page:
            break
        for row in page:
            scanned += 1
            srcs = extract_sources(row.get("logs"))
            if not srcs:
                continue
            social_hits = [(s, is_social(s)) for s in srcs]
            social_hits = [(s, host) for (s, host) in social_hits if host]
            if not social_hits:
                continue
            examples.append({
                "run_id": row["id"],
                "tweet_id": row["tweet_id"],
                "created_at": row["created_at"],
                "outcome": row["outcome"],
                "note_text": row["note_text"],
                "all_sources": srcs,
                "social_sources": [{"url": s, "host": h} for (s, h) in social_hits],
            })
            if len(examples) >= TARGET_EXAMPLES:
                break
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    print(f"Scanned {scanned} simple-bot runs from the last {LOOKBACK_DAYS} days.")
    print(f"Found {len(examples)} runs with at least one social-media source.\n")

    for i, ex in enumerate(examples, 1):
        print(f"--- Example {i} ---")
        print(f"  run_id:    {ex['run_id']}")
        print(f"  tweet_id:  {ex['tweet_id']}")
        print(f"  created:   {ex['created_at']}")
        print(f"  outcome:   {ex['outcome']}")
        print(f"  note:      {ex['note_text']}")
        print(f"  social sources:")
        for s in ex["social_sources"]:
            print(f"    [{s['host']}] {s['url']}")
        other = [s for s in ex["all_sources"] if s not in [x["url"] for x in ex["social_sources"]]]
        if other:
            print(f"  other sources:")
            for s in other:
                print(f"    {s}")
        print()

    out_path = os.path.join(os.path.dirname(__file__), "social_source_examples.json")
    with open(out_path, "w") as f:
        json.dump(examples, f, indent=2)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
