"""Extract the recent notes from the public Community Notes dump (GOO-835).

Reads the dump of 2026-11-13 and writes one parquet file with every note created
since 2026-08-01: its tweet, author, classification, text, and its current
status from the status history. A second step counts each note's ratings,
because a note that sits at "Needs more ratings" after hundreds of ratings
means something different from one that nobody rated.

Run from the worktree root:
  uv run --with pandas --with pyarrow src/scripts_jim/2026_11_20_tweet_note_prefilter/extract_public_notes.py notes
  uv run --with pandas --with pyarrow src/scripts_jim/2026_11_20_tweet_note_prefilter/extract_public_notes.py ratings
"""

import csv
import io
import sys
import zipfile
from pathlib import Path

import pandas as pd

DUMP_DIR = Path("/home/jim/dev/data/cn-public-data/2026-11-13")
OUT_DIR = Path("/home/jim/dev/data/goo-835")
NOTES_SINCE_MILLIS = int(pd.Timestamp("2026-08-01", tz="UTC").timestamp() * 1000)
RATINGS_CHUNK_ROWS = 5_000_000

csv.field_size_limit(sys.maxsize)


def read_zipped_tsv(path: Path, columns: list[str], chunksize: int | None = None):
    archive = zipfile.ZipFile(path)
    raw = archive.open(archive.namelist()[0])
    return pd.read_csv(io.TextIOWrapper(raw, encoding="utf-8"), sep="\t", usecols=columns, dtype=str, quoting=csv.QUOTE_NONE, engine="c", on_bad_lines="skip", chunksize=chunksize)


def extract_notes() -> None:
    columns = ["noteId", "noteAuthorParticipantId", "createdAtMillis", "tweetId", "classification", "summary", "isMediaNote", "isCollaborativeNote"]
    parts = []
    for path in sorted(DUMP_DIR.glob("notes-*.zip")):
        notes = read_zipped_tsv(path, columns)
        created = pd.to_numeric(notes["createdAtMillis"], errors="coerce")
        parts.append(notes[created >= NOTES_SINCE_MILLIS])
    notes = pd.concat(parts)
    status_columns = ["noteId", "currentStatus", "firstNonNMRStatus", "timestampMillisOfFirstNonNMRStatus", "lockedStatus"]
    status = read_zipped_tsv(DUMP_DIR / "noteStatusHistory-00000.zip", status_columns)
    notes = notes.merge(status, on="noteId", how="left")
    notes.to_parquet(OUT_DIR / "public_notes_since_2026_08.parquet")
    print(f"{len(notes)} notes on {notes['tweetId'].nunique()} tweets")
    print(notes["currentStatus"].value_counts().to_string())


def count_ratings() -> None:
    note_ids = set(pd.read_parquet(OUT_DIR / "public_notes_since_2026_08.parquet", columns=["noteId"])["noteId"])
    counts: dict[str, pd.Series] = {}
    for path in sorted(DUMP_DIR.glob("ratings-*.zip")):
        for chunk in read_zipped_tsv(path, ["noteId", "helpfulnessLevel"], chunksize=RATINGS_CHUNK_ROWS):
            recent = chunk[chunk["noteId"].isin(note_ids)]
            table = recent.groupby(["noteId", "helpfulnessLevel"]).size()
            for key, value in table.items():
                counts[key] = counts.get(key, 0) + value
        print(f"done {path.name}: {len(counts)} (note, level) pairs", flush=True)
    rows = [{"noteId": note_id, "level": level, "count": count} for (note_id, level), count in counts.items()]
    wide = pd.DataFrame(rows).pivot_table(index="noteId", columns="level", values="count", fill_value=0).reset_index()
    wide.to_parquet(OUT_DIR / "public_rating_counts.parquet")
    print(f"{len(wide)} notes with ratings")


{"notes": extract_notes, "ratings": count_ratings}[sys.argv[1]]()
