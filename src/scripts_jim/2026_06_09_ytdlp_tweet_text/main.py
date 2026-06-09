"""Probe what yt-dlp can extract from X/Twitter status links.

Source verification currently accepts every x.com link blindly. Idea: use
yt-dlp --dump-json to actually pull the tweet text + author so the verifier
can check whether the cited tweet supports the note's claim.

Run from repo root:  uv run src/scripts_jim/2026_06_09_ytdlp_tweet_text/main.py
"""

import json
import subprocess

# The 3 sources cited by the prod note on tweet 2063880844280742265 (@TiimoTP),
# plus the post itself.
URLS = [
    "https://x.com/TiimoTP/status/2063880844280742265",  # the post we noted
    "https://x.com/KikoThePlebian/status/2064085502068715765",
    "https://x.com/AndyGamingMad/status/2063919182509441087",
    "https://x.com/PsychoMadTv/status/2063745739591663853",
]

# Fields worth surfacing for verification.
INTERESTING_FIELDS = [
    "title",
    "description",
    "uploader",
    "uploader_id",
    "uploader_url",
    "timestamp",
    "upload_date",
    "like_count",
    "repost_count",
    "comment_count",
    "duration",
]


def probe(url: str) -> None:
    print("=" * 80)
    print(url)
    print("=" * 80)
    proc = subprocess.run(
        ["yt-dlp", "--dump-json", "--no-warnings", url],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0:
        print(f"  [FAILED rc={proc.returncode}]")
        print("  stderr:", proc.stderr.strip()[:1000] or "(none)")
        return

    # yt-dlp may emit one JSON object per media entry (a tweet can have several).
    for line in proc.stdout.strip().splitlines():
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        for field in INTERESTING_FIELDS:
            value = data.get(field)
            if value not in (None, "", []):
                print(f"  {field:14}: {value}")
        print("-" * 40)


if __name__ == "__main__":
    for url in URLS:
        try:
            probe(url)
        except subprocess.TimeoutExpired:
            print(f"  [TIMEOUT] {url}")
        print()
