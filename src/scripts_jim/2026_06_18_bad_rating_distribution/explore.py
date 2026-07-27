"""Explore not-helpful rating tags on our notes before plotting.

Source: note_ratings_from_public_dump (one row per note; not_helpful_tag_counts
is a JSONB dict tag -> count). All rows are our author's notes.

Prints: # notes, # with >=1 not-helpful rating, per-tag total + how many notes
carry each tag, and the max/percentile per-note count so we can size histogram bins.

Run: uv run src/scripts_jim/2026_06_18_bad_rating_distribution/explore.py
"""

import os
import statistics
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

PAGE = 1000


def fetch_all():
    """One row per note (latest dump). Paginate past the 1000-row cap."""
    latest = {}  # note_id -> (dump_date, row)
    offset = 0
    while True:
        rows = (
            sb.table("note_ratings_from_public_dump")
            .select("note_id, not_helpful_count, helpful_count, not_helpful_tag_counts, dump_date")
            .range(offset, offset + PAGE - 1)
            .execute()
            .data
        )
        for r in rows:
            nid, d = r["note_id"], r["dump_date"] or ""
            if nid not in latest or d > latest[nid][0]:
                latest[nid] = (d, r)
        if len(rows) < PAGE:
            break
        offset += PAGE
    return [row for _, row in latest.values()]


rows = fetch_all()
print(f"notes in table: {len(rows)}")

with_nh = [r for r in rows if (r.get("not_helpful_count") or 0) > 0]
print(f"notes with >=1 not-helpful rating: {len(with_nh)}")

tag_total = defaultdict(int)        # tag -> sum of counts across notes
tag_notes = defaultdict(int)        # tag -> # notes with that tag >=1
per_note_counts = defaultdict(list) # tag -> list of per-note counts (only where >=1)
for r in rows:
    tags = r.get("not_helpful_tag_counts") or {}
    for tag, cnt in tags.items():
        if cnt and cnt > 0:
            tag_total[tag] += cnt
            tag_notes[tag] += 1
            per_note_counts[tag].append(cnt)

print(f"\ndistinct not-helpful tags: {len(tag_total)}\n")
print(f"{'tag':<42}{'total':>8}{'#notes':>8}{'max':>6}{'p90':>6}{'mean':>7}")
for tag, total in sorted(tag_total.items(), key=lambda kv: -kv[1]):
    vals = per_note_counts[tag]
    p90 = statistics.quantiles(vals, n=10)[8] if len(vals) >= 10 else max(vals)
    print(f"{tag:<42}{total:>8}{tag_notes[tag]:>8}{max(vals):>6}{p90:>6.0f}{statistics.mean(vals):>7.1f}")

nh_counts = [r.get("not_helpful_count") or 0 for r in with_nh]
if nh_counts:
    print(f"\nnot_helpful_count per rated note: max={max(nh_counts)} "
          f"median={statistics.median(nh_counts):.0f} mean={statistics.mean(nh_counts):.1f}")
