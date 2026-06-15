"""
Scraper coverage map.

The notewriter page lists our notes newest-first; the scraper scrolls down and
clicks each note. note_id is a Twitter snowflake, so it encodes the note's
creation time. To find time windows the scraper never reached, we:

  1. pull every snapshot (note_id, scraped_at) from scraped_notewriter_snapshots
  2. decode each note_id -> note creation day
  3. per creation-day, count distinct notes and the MOST RECENT scrape date

A day with notes that were last scraped weeks ago (or never beyond one early
run) is a stale/under-covered window. We also cross-check against `notes`
submitted_at to see days where we submitted notes but have thin snapshot
coverage.
"""
import os
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

TWITTER_EPOCH_MS = 1288834974657
PAGE = 1000


def snowflake_day(note_id: str) -> str | None:
    if not note_id or not note_id.isdigit():
        return None
    ts_ms = (int(note_id) >> 22) + TWITTER_EPOCH_MS
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def fetch_all(table: str, cols: str, key: str, start: str = ""):
    rows = []
    last = start
    while True:
        q = sb.table(table).select(cols).order(key).gt(key, last).limit(PAGE)
        batch = q.execute().data
        if not batch:
            break
        rows.extend(batch)
        last = batch[-1][key]
        if len(batch) < PAGE:
            break
    return rows


print("Fetching snapshots...")
snaps = fetch_all("scraped_notewriter_snapshots", "id, note_id, scraped_at", "id",
                  start="00000000-0000-0000-0000-000000000000")
print(f"  {len(snaps)} snapshots")

# Per note-creation-day: distinct notes + latest scrape over all its snapshots
notes_per_day: dict[str, set] = defaultdict(set)
latest_scrape_per_day: dict[str, str] = {}
for s in snaps:
    day = snowflake_day(s["note_id"])
    if not day:
        continue
    notes_per_day[day].add(s["note_id"])
    sc = (s.get("scraped_at") or "")[:10]
    if sc and sc > latest_scrape_per_day.get(day, ""):
        latest_scrape_per_day[day] = sc

print("\nFetching notes (submitted_at)...")
notes = fetch_all("notes", "note_id, submitted_at", "note_id")
submitted_per_day: dict[str, int] = defaultdict(int)
known_per_day: dict[str, int] = defaultdict(int)
for n in notes:
    day = snowflake_day(n["note_id"])
    if not day:
        continue
    known_per_day[day] += 1
    if n.get("submitted_at"):
        submitted_per_day[day] += 1

all_days = sorted(set(notes_per_day) | set(known_per_day))
print(f"\n{'day':<12}{'notes_in_db':>12}{'scraped':>10}{'last_scrape':>14}")
print("-" * 48)
for day in all_days:
    n_db = known_per_day.get(day, 0)
    n_scraped = len(notes_per_day.get(day, ()))
    last = latest_scrape_per_day.get(day, "—")
    flag = ""
    if n_db > 0 and n_scraped < n_db:
        flag = "  <-- under-covered"
    if n_db > 0 and n_scraped == 0:
        flag = "  <== NO SNAPSHOTS"
    print(f"{day:<12}{n_db:>12}{n_scraped:>10}{last:>14}{flag}")
