"""
Inspect the raw JSON response from SearXNG Google search.

The pipeline (src/pipeline/tool-calling/tools.ts) only extracts title/url/content
from each result and takes the first 10. This script shows:

1. The full raw JSON returned by SearXNG
2. All keys present on each result (what else could we be using?)
3. Title/content lengths + whether they already end with "..." in the raw data
   (to determine whether the cutoff is in SearXNG/Google or just in our logs)
4. Top-level response metadata (suggestions, infoboxes, answers, etc.)
"""

import json
import os
import sys
from collections import Counter
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv

load_dotenv()

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8080")
DEFAULT_QUERY = "Elon Musk tweet fact check"
PIPELINE_MAX_RESULTS = 10  # mirrors SEARXNG_MAX_RESULTS in tools.ts


def fetch(query: str) -> dict:
    params = {"q": query, "format": "json", "engines": "google"}
    url = f"{SEARXNG_URL}/search?{urlencode(params)}"
    print(f"GET {url}\n")
    response = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; CommunityNotesBot/1.0)"},
        timeout=15,
    )
    response.raise_for_status()
    return response.json()


def analyze_truncation(results: list[dict]) -> None:
    print("=" * 80)
    print("TRUNCATION ANALYSIS")
    print("=" * 80)
    title_ellipsis = 0
    content_ellipsis = 0
    title_lens: list[int] = []
    content_lens: list[int] = []
    for r in results:
        title = r.get("title") or ""
        content = r.get("content") or ""
        title_lens.append(len(title))
        content_lens.append(len(content))
        if title.rstrip().endswith("...") or title.rstrip().endswith("…"):
            title_ellipsis += 1
        if content.rstrip().endswith("...") or content.rstrip().endswith("…"):
            content_ellipsis += 1

    def stats(xs: list[int]) -> str:
        if not xs:
            return "n/a"
        return f"min={min(xs)} max={max(xs)} avg={sum(xs) // len(xs)}"

    print(f"Titles ending in '...': {title_ellipsis}/{len(results)}  (lengths: {stats(title_lens)})")
    print(f"Content ending in '...': {content_ellipsis}/{len(results)}  (lengths: {stats(content_lens)})")
    print()


def analyze_fields(results: list[dict]) -> None:
    print("=" * 80)
    print("AVAILABLE FIELDS PER RESULT (used by pipeline vs. ignored)")
    print("=" * 80)
    pipeline_used = {"title", "url", "content"}
    key_counts: Counter[str] = Counter()
    for r in results:
        key_counts.update(r.keys())
    for key, count in sorted(key_counts.items(), key=lambda kv: -kv[1]):
        tag = "USED" if key in pipeline_used else "IGNORED"
        print(f"  [{tag:7}] {key:20} present in {count}/{len(results)} results")
    print()


def print_top_level(data: dict) -> None:
    print("=" * 80)
    print("TOP-LEVEL RESPONSE KEYS (besides 'results')")
    print("=" * 80)
    for key, value in data.items():
        if key == "results":
            print(f"  results: <{len(value)} entries>")
            continue
        preview = json.dumps(value, ensure_ascii=False)
        if len(preview) > 200:
            preview = preview[:200] + "..."
        print(f"  {key}: {preview}")
    print()


def print_full_results(results: list[dict]) -> None:
    print("=" * 80)
    print(f"FULL RESULTS (first {PIPELINE_MAX_RESULTS} — what the pipeline would see)")
    print("=" * 80)
    for i, r in enumerate(results[:PIPELINE_MAX_RESULTS]):
        print(f"\n--- Result {i + 1} ---")
        print(json.dumps(r, indent=2, ensure_ascii=False))
    print()


def main() -> None:
    query = " ".join(sys.argv[1:]) or DEFAULT_QUERY
    print(f"Query: {query!r}")
    print(f"SearXNG: {SEARXNG_URL}\n")

    data = fetch(query)
    results = data.get("results", [])
    print(f"Got {len(results)} results total.\n")

    print_top_level(data)
    analyze_fields(results)
    analyze_truncation(results)
    print_full_results(results)

    out_path = os.path.join(os.path.dirname(__file__), "last_response.json")
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Full raw JSON written to {out_path}")


if __name__ == "__main__":
    main()
