"""Run Google Lens (via SerpAPI) on a public image URL, dump full JSON, summarise fields.

Usage:
    uv run src/scripts_jim/2026_05_15_serpapi_lens_probe/lens_probe.py <image_url>
    uv run src/scripts_jim/2026_05_15_serpapi_lens_probe/lens_probe.py <local_path_with_twitter_id>

If a local file is given whose basename matches an X/Twitter media ID
(e.g. HIR6DJ0W4AACPXK.jpeg), the script rewrites it to the pbs.twimg.com URL
that already hosts that image publicly. SerpAPI Google Lens requires a URL —
it does not accept file uploads.
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from typing import Any

from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
load_dotenv(os.path.join(HERE, "../../../.env"))

SERPAPI_KEY = os.environ.get("SERPAPI_KEY")
SERPAPI_URL = "https://serpapi.com/search"
TWITTER_MEDIA_ID = re.compile(r"^[A-Za-z0-9_-]{15}$")


def resolve_image_url(arg: str) -> str:
    if arg.startswith("http://") or arg.startswith("https://"):
        return arg
    stem = os.path.splitext(os.path.basename(arg))[0]
    if TWITTER_MEDIA_ID.match(stem):
        return f"https://pbs.twimg.com/media/{stem}.jpg"
    raise SystemExit(
        f"'{arg}' is not a URL and its filename doesn't look like an X media ID. "
        "SerpAPI Google Lens needs a public URL — upload the file somewhere first."
    )


def call_google_lens(image_url: str) -> dict[str, Any]:
    params = {"engine": "google_lens", "url": image_url, "api_key": SERPAPI_KEY}
    full_url = f"{SERPAPI_URL}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(full_url, timeout=120) as resp:
        return json.loads(resp.read())


def summarise(data: dict[str, Any]) -> None:
    print("\n=== TOP-LEVEL KEYS ===")
    for key, value in data.items():
        if isinstance(value, list):
            print(f"  {key}: list[{len(value)}]")
        elif isinstance(value, dict):
            print(f"  {key}: dict({list(value.keys())})")
        else:
            print(f"  {key}: {type(value).__name__}")

    visual = data.get("visual_matches", [])
    if visual:
        print(f"\n=== visual_matches ({len(visual)}) — all fields on first item ===")
        for k, v in visual[0].items():
            print(f"  {k}: {v!r}")
        print(f"\n=== first 10 visual_matches: source / title / link ===")
        for m in visual[:10]:
            print(f"  - [{m.get('source','?')}] {(m.get('title') or '(no title)')[:90]}")
            print(f"      {m.get('link')}")

    for key in ("exact_matches", "related_content", "ai_overview", "knowledge_graph"):
        if key in data and data[key]:
            value = data[key]
            count = len(value) if isinstance(value, list) else 1
            print(f"\n=== {key} ({count}) ===")
            sample = value[0] if isinstance(value, list) else value
            if isinstance(sample, dict):
                for k, v in sample.items():
                    print(f"  {k}: {str(v)[:120]}")


def main() -> None:
    if not SERPAPI_KEY:
        print("ERROR: set SERPAPI_KEY in .env (free tier at https://serpapi.com = 100 searches/mo)")
        sys.exit(1)
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    image_url = resolve_image_url(sys.argv[1])
    print(f"image URL: {image_url}")
    print("Calling Google Lens via SerpAPI…")
    data = call_google_lens(image_url)

    out_path = os.path.join(HERE, "lens_response.json")
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  full response written to {out_path}")

    summarise(data)


if __name__ == "__main__":
    main()
