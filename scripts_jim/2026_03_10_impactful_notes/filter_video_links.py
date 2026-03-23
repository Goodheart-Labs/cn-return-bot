"""Filter deduped CSV to only rows where the tweet contains TikTok, YouTube Shorts, or Instagram Reels links."""

import csv
import re

INPUT = "analyze_community_notes/helpful_cn_notes.csv"
OUTPUT = "analyze_community_notes/helpful_cn_notes_video_links.csv"

VIDEO_LINK_PATTERN = re.compile(
    r"tiktok\.com|youtu\.be/shorts|youtube\.com/shorts|instagram\.com/reel",
    re.IGNORECASE,
)

with open(INPUT, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    rows = list(reader)

matches = [r for r in rows if VIDEO_LINK_PATTERN.search(r["tweet_text"])]

with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=["tweet_text", "note_text", "has_photo", "has_video"])
    writer.writeheader()
    writer.writerows(matches)

print(f"Input: {len(rows)} rows")
print(f"Matched: {len(matches)} rows with video links")
print(f"Output: {OUTPUT}")
