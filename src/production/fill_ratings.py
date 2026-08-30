"""Populate note_ratings_from_public_dump from the X CN public data dump.

Reads notes-*.tsv to find every note authored by our notewriter, then streams
the ratings-*.tsv partitions and aggregates per-note helpfulness counts and
non-zero tag counts. Upserts one row per note.

Run from repo root:
  uv run src/production/fill_ratings.py --local
  uv run src/production/fill_ratings.py             # prod

In CI the script runs with --stream. It then downloads each ratings shard on
demand and deletes it again after scanning. The 8 partitions add up to about
40 GB, so a GitHub-hosted runner's disk cannot hold them all at once.
"""

import argparse
import csv
import io
import json
import os
import sys
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

CN_DATA_BASE_URL = "https://ton.twimg.com/birdwatch-public-data"
CN_DATA_DIR = Path(__file__).resolve().parent / "cn_data"
CACHE_PATH = Path(__file__).resolve().parent / "_aggregates_cache.json"
DOWNLOAD_LOOKBACK_DAYS = 7

# The dump grows a partition every few months. Notes went from 2 to 3 in July
# 2026. We discover the count by probing rather than hardcoding it, so a new
# partition never silently drops notes or ratings. In the constants below,
# file_type is the segment in the URL path and prefix is the stem of the
# filename on disk. They differ only for ratings.
NOTE_FILE_TYPE, NOTE_PREFIX = "notes", "notes"
RATING_FILE_TYPE, RATING_PREFIX = "noteRatings", "ratings"
AUTHOR_ID = "813EB394B10809EBA8D09BCFA8E2E1C25A2DA0085186867F9E9C00696951C447"

# Columns in the public-dump ratings TSV that are NOT per-tag flags.
NON_TAG_HELPFUL_COLUMNS = {"helpful", "helpfulnessLevel"}
NON_TAG_NOT_HELPFUL_COLUMNS = {"notHelpful"}

HELPFULNESS_BUCKETS = {
    "HELPFUL": "helpful_count",
    "SOMEWHAT_HELPFUL": "somewhat_helpful_count",
    "NOT_HELPFUL": "not_helpful_count",
}

# Supabase REST has a ceiling on request size. 500 rows per upsert keeps us
# safely under it.
UPSERT_BATCH = 500
# The csv module's default field-size limit is too low for the occasional long
# row.
csv.field_size_limit(sys.maxsize)


def download_and_extract(file_type: str, partition: str, date_str: str) -> bool:
    out_path = CN_DATA_DIR / partition
    if out_path.exists():
        size_mb = out_path.stat().st_size / (1024 * 1024)
        print(f"  {partition} already exists ({size_mb:.1f} MB), skipping download")
        return True

    zip_name = partition.replace(".tsv", ".zip")
    url = f"{CN_DATA_BASE_URL}/{date_str}/{file_type}/{zip_name}"
    print(f"  Trying {url}...")

    resp = requests.get(url)
    if resp.status_code != 200:
        print(f"    HTTP {resp.status_code}, skipping")
        return False

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        zf.extractall(CN_DATA_DIR)

    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"    Extracted {partition} ({size_mb:.1f} MB)")
    return True


def try_download_partition(file_type: str, partition: str) -> bool:
    """Try today's daily snapshot date first, then walk back one day at a time
    for up to DOWNLOAD_LOOKBACK_DAYS days."""
    for days_back in range(DOWNLOAD_LOOKBACK_DAYS):
        date = datetime.now(timezone.utc) - timedelta(days=days_back)
        date_str = date.strftime("%Y/%m/%d")
        if download_and_extract(file_type, partition, date_str):
            return True
    return False


def resolve_dump_date(file_type: str, prefix: str) -> str | None:
    """Return the most recent snapshot date within the lookback window whose
    partition 0 exists."""
    for days_back in range(DOWNLOAD_LOOKBACK_DAYS):
        date_str = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y/%m/%d")
        url = f"{CN_DATA_BASE_URL}/{date_str}/{file_type}/{prefix}-00000.zip"
        if requests.head(url).status_code == 200:
            return date_str
    return None


def discover_partition_files(file_type: str, prefix: str) -> list[str]:
    """Enumerate every partition in the latest dump. This walks the index up
    from 0 until the CDN returns a 404, so a newly added partition is picked up
    on its own."""
    date_str = resolve_dump_date(file_type, prefix)
    if date_str is None:
        return []
    files: list[str] = []
    index = 0
    while requests.head(f"{CN_DATA_BASE_URL}/{date_str}/{file_type}/{prefix}-{index:05d}.zip").status_code == 200:
        files.append(f"{prefix}-{index:05d}.tsv")
        index += 1
    return files


def existing_partition_files(prefix: str) -> list[str]:
    return sorted(p.name for p in CN_DATA_DIR.glob(f"{prefix}-*.tsv"))


def ensure_notes_files() -> None:
    CN_DATA_DIR.mkdir(parents=True, exist_ok=True)
    note_files = discover_partition_files(NOTE_FILE_TYPE, NOTE_PREFIX)
    if not note_files:
        raise SystemExit("no notes-*.tsv partitions found in the dump")
    print(f"[notes] dump has {len(note_files)} note partitions")
    for fname in note_files:
        if (CN_DATA_DIR / fname).exists():
            continue
        if not try_download_partition(NOTE_FILE_TYPE, fname):
            raise SystemExit(f"failed to download {fname}")


def load_our_note_ids() -> set[str]:
    ids: set[str] = set()
    note_files = existing_partition_files(NOTE_PREFIX)
    if not note_files:
        print("[notes] no notes-*.tsv on disk")
    for fname in note_files:
        path = CN_DATA_DIR / fname
        with path.open() as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                if row.get("noteAuthorParticipantId") == AUTHOR_ID:
                    ids.add(row["noteId"])
        print(f"[notes] {fname}: {len(ids)} cumulative author notes")
    return ids


def classify_tag_columns(header: list[str]) -> tuple[list[str], list[str]]:
    helpful_tags: list[str] = []
    not_helpful_tags: list[str] = []
    for col in header:
        if col.startswith("notHelpful") and col not in NON_TAG_NOT_HELPFUL_COLUMNS:
            not_helpful_tags.append(col)
        elif col.startswith("helpful") and col not in NON_TAG_HELPFUL_COLUMNS:
            helpful_tags.append(col)
    return helpful_tags, not_helpful_tags


def empty_agg() -> dict:
    return {
        "helpful_count": 0,
        "somewhat_helpful_count": 0,
        "not_helpful_count": 0,
        "helpful_tag_counts": defaultdict(int),
        "not_helpful_tag_counts": defaultdict(int),
    }


def aggregate_ratings(our_note_ids: set[str], stream: bool) -> dict[str, dict]:
    """Walk every ratings partition. In stream mode each shard is downloaded on
    demand and deleted again after scanning, so we stay under the runner's disk
    limit."""
    aggregates: dict[str, dict] = defaultdict(empty_agg)
    helpful_tags: list[str] = []
    not_helpful_tags: list[str] = []
    total_rows = 0
    matched_rows = 0

    if stream:
        rating_files = discover_partition_files(RATING_FILE_TYPE, RATING_PREFIX)
        if not rating_files:
            raise SystemExit("no ratings-*.tsv partitions found in the dump")
        print(f"[ratings] dump has {len(rating_files)} rating partitions")
    else:
        rating_files = existing_partition_files(RATING_PREFIX)

    for fname in rating_files:
        path = CN_DATA_DIR / fname
        downloaded_here = False
        if not path.exists():
            if not stream:
                print(f"[ratings] missing {fname}, skipping")
                continue
            print(f"[ratings] downloading {fname}...")
            if not try_download_partition(RATING_FILE_TYPE, fname):
                print(f"[ratings] failed to download {fname}, skipping")
                continue
            downloaded_here = True
        try:
            with path.open() as f:
                reader = csv.DictReader(f, delimiter="\t")
                if not helpful_tags:
                    helpful_tags, not_helpful_tags = classify_tag_columns(reader.fieldnames or [])
                    print(f"[ratings] tag columns: {len(helpful_tags)} helpful, {len(not_helpful_tags)} not-helpful")
                file_matched = 0
                for row in reader:
                    total_rows += 1
                    note_id = row["noteId"]
                    if note_id not in our_note_ids:
                        continue
                    matched_rows += 1
                    file_matched += 1
                    agg = aggregates[note_id]
                    bucket_col = HELPFULNESS_BUCKETS.get(row.get("helpfulnessLevel") or "")
                    if bucket_col:
                        agg[bucket_col] += 1
                    for tag in helpful_tags:
                        if row.get(tag) == "1":
                            agg["helpful_tag_counts"][tag] += 1
                    for tag in not_helpful_tags:
                        if row.get(tag) == "1":
                            agg["not_helpful_tag_counts"][tag] += 1
            print(f"[ratings] {fname}: scanned, matched {file_matched} of our notes")
        finally:
            if downloaded_here:
                path.unlink(missing_ok=True)
                print(f"[ratings] deleted {fname}")
    print(f"[ratings] total rows scanned: {total_rows:,}, matched: {matched_rows:,}")
    return aggregates


def prune_zero_tags(tag_counts: dict[str, int]) -> dict[str, int]:
    return {k: v for k, v in tag_counts.items() if v > 0}


def build_upsert_rows(aggregates: dict[str, dict], dump_date: str) -> list[dict]:
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = []
    for note_id, agg in aggregates.items():
        rows.append(
            {
                "note_id": note_id,
                "helpful_count": agg["helpful_count"],
                "somewhat_helpful_count": agg["somewhat_helpful_count"],
                "not_helpful_count": agg["not_helpful_count"],
                "helpful_tag_counts": prune_zero_tags(agg["helpful_tag_counts"]),
                "not_helpful_tag_counts": prune_zero_tags(agg["not_helpful_tag_counts"]),
                "dump_date": dump_date,
                "last_synced_at": now_iso,
            }
        )
    return rows


def latest_dump_date_from_disk() -> str:
    # Take the dump date from the modification time of the first of these files
    # that exists on disk. noteStatusHistory comes first because the data
    # fetcher always downloads it together with the notes and ratings files.
    candidates = ["noteStatusHistory-00000.tsv", "notes-00000.tsv", "ratings-00000.tsv"]
    for fname in candidates:
        path = CN_DATA_DIR / fname
        if path.exists():
            return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).date().isoformat()
    return datetime.now(timezone.utc).date().isoformat()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="use LOCAL_SUPABASE_* env vars")
    parser.add_argument("--limit", type=int, default=None, help="only upsert first N rows (smoke test)")
    parser.add_argument(
        "--stream",
        action="store_true",
        help="download each ratings shard on demand and delete after scanning — for CI where disk is tight",
    )
    parser.add_argument("--no-cache", action="store_true", help="ignore _aggregates_cache.json and rescan")
    args = parser.parse_args()

    load_dotenv()
    url_var = "LOCAL_SUPABASE_URL" if args.local else "SUPABASE_URL"
    key_var = "LOCAL_SUPABASE_SERVICE_KEY" if args.local else "SUPABASE_SERVICE_KEY"
    url = os.environ.get(url_var)
    key = os.environ.get(key_var)
    if not url or not key:
        raise SystemExit(f"missing {url_var} / {key_var}")
    client = create_client(url, key)

    if args.stream:
        ensure_notes_files()
    dump_date = latest_dump_date_from_disk()

    if CACHE_PATH.exists() and not args.no_cache:
        print(f"[cache] loading aggregates from {CACHE_PATH.name}")
        with CACHE_PATH.open() as f:
            rows = json.load(f)
        print(f"[cache] {len(rows):,} rows loaded")
    else:
        our_note_ids = load_our_note_ids()
        print(f"\nOur notes in dump: {len(our_note_ids):,}\n")
        if not our_note_ids:
            raise SystemExit("no notes found for author — check AUTHOR_ID and that notes-*.tsv are downloaded")

        aggregates = aggregate_ratings(our_note_ids, stream=args.stream)
        print(f"\nNotes with at least one rating: {len(aggregates):,}\n")
        rows = build_upsert_rows(aggregates, dump_date)
        with CACHE_PATH.open("w") as f:
            json.dump(rows, f)
        print(f"[cache] wrote {len(rows):,} rows to {CACHE_PATH.name}")
    if args.limit:
        rows = rows[: args.limit]
        print(f"[limit] truncated to {len(rows)} rows for smoke test")

    # Keep only the note_ids that already exist in `notes`, so the upsert cannot
    # fail on a foreign key. PostgREST caps a response at 1000 rows per request,
    # so we have to paginate. A plain `.execute()` would silently truncate and
    # drop every row past the first 1000.
    existing_ids: set[str] = set()
    page = 1000
    offset = 0
    while True:
        resp = client.table("notes").select("note_id").range(offset, offset + page - 1).execute()
        batch = resp.data or []
        existing_ids.update(r["note_id"] for r in batch)
        if len(batch) < page:
            break
        offset += page
    rows_to_upsert = [r for r in rows if r["note_id"] in existing_ids]
    print(f"Existing notes loaded: {len(existing_ids):,}")
    print(f"Rows with matching notes row: {len(rows_to_upsert):,} of {len(rows):,}")

    for i in range(0, len(rows_to_upsert), UPSERT_BATCH):
        batch = rows_to_upsert[i : i + UPSERT_BATCH]
        client.table("note_ratings_from_public_dump").upsert(batch, on_conflict="note_id").execute()
        print(f"upserted {i + len(batch):,}/{len(rows_to_upsert):,}")

    print(f"\nDone — dump_date={dump_date}")


if __name__ == "__main__":
    main()
