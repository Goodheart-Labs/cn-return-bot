# /// script
# requires-python = ">=3.10"
# dependencies = ["requests", "python-dotenv", "psycopg2-binary"]
# ///
"""GOO-57 step 1: measure feed coverage.

For every feed in everything_followed_feeds, list what the source itself
publishes (Substack RSS / YouTube channel videos tab) and check each entry
against everything_items. The gap between the two lists is the answer to
"are all new videos and posts fetched and processed".

Matching mirrors production: Substack by exact URL, YouTube by video id
substring. A secondary slug match flags entries where production's exact-URL
matching would miss an item that actually exists under a different URL form.

Run from the workspace root:
  uv run src/scripts_jim/2026_08_30_feed_coverage/coverage.py
"""

import re
import subprocess
import xml.etree.ElementTree as ET

import os

import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv()

YOUTUBE_LIMIT = 15
PAYWALL_TRAILER = re.compile(r'<a href="[^"]*">\s*Read more\s*</a>\s*</p>\s*$')


def fetch_db():
    conn = psycopg2.connect(os.environ["PROD_DB_URL"])
    cur = conn.cursor()
    cur.execute(
        "select project_slug, feed_type, feed_url, priority, sort_order"
        " from everything_followed_feeds order by priority desc, sort_order asc"
    )
    feeds = cur.fetchall()
    cur.execute(
        "select url, status, checked_scope, error, created_at::date, processed_at::date, published_at"
        " from everything_items"
    )
    items = cur.fetchall()
    conn.close()
    return feeds, items


def substack_entries(feed_url):
    res = requests.get(feed_url.rstrip("/") + "/feed", timeout=30)
    res.raise_for_status()
    entries = []
    # Substack RSS bodies contain raw CDATA; ElementTree handles it fine.
    root = ET.fromstring(res.content)
    for item in root.iter("item"):
        link = (item.findtext("link") or "").strip()
        title = (item.findtext("title") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        body = item.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or ""
        entries.append(
            {
                "url": link,
                "title": title,
                "published": pub,
                "paywalled": bool(PAYWALL_TRAILER.search(body.strip())),
                "match_key": link,
            }
        )
    return entries


def youtube_entries(channel_url):
    out = subprocess.run(
        [
            "yt-dlp", "--flat-playlist", "--no-warnings",
            "--playlist-items", f"1:{YOUTUBE_LIMIT}",
            "--print", "%(id)s\t%(duration)s\t%(upload_date)s\t%(title)s",
            channel_url.rstrip("/") + "/videos",
        ],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        raise RuntimeError(f"yt-dlp failed for {channel_url}: {out.stderr[:500]}")
    entries = []
    for line in out.stdout.strip().splitlines():
        vid, duration, upload_date, *title = line.split("\t")
        entries.append(
            {
                "url": f"https://www.youtube.com/watch?v={vid}",
                "title": "\t".join(title),
                "published": upload_date if upload_date != "NA" else "",
                "premiere": not re.match(r"^\d", duration),
                "match_key": vid,
            }
        )
    return entries


def slug(url):
    return url.rstrip("/").split("/")[-1].split("?")[0]


def main():
    feeds, items = fetch_db()
    print(f"{len(feeds)} followed feeds, {len(items)} everything_items rows total\n")

    for project_slug, feed_type, feed_url, priority, sort_order in feeds:
        print(f"## {project_slug} ({feed_type}, priority {priority}) — {feed_url}")
        try:
            entries = substack_entries(feed_url) if feed_type == "substack" else youtube_entries(feed_url)
        except Exception as e:
            print(f"  FEED FETCH FAILED: {e}\n")
            continue
        for e in entries:
            exact = [i for i in items if (e["match_key"] in i[0] if feed_type == "youtube" else i[0] == e["match_key"])]
            fuzzy = [] if exact else [i for i in items if slug(i[0]) == slug(e["url"]) and slug(e["url"])]
            flags = []
            if e.get("paywalled"):
                flags.append("PAYWALLED")
            if e.get("premiere"):
                flags.append("PREMIERE")
            if exact:
                url, status, scope, error, created, processed, published_at = exact[0]
                state = f"item: {status}/{scope}" + (f" ERROR={error[:80]}" if error else "") + f" (enqueued {created}, processed {processed})"
            elif fuzzy:
                state = f"MISSED BY EXACT MATCH but slug-matches item {fuzzy[0][0]} ({fuzzy[0][1]})"
            else:
                state = "NO ITEM ROW"
            print(f"  [{e['published'][:16]:16}] {' '.join(flags):10} {state:70} | {e['title'][:60]}")
        print()


if __name__ == "__main__":
    main()
