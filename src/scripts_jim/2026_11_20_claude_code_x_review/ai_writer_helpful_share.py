"""How often each prolific note author's notes end up rated helpful (GOO-829).

Reads the public Community Notes dump of 2026-11-13 and counts, for every
author with many misleading-tagged notes written between 2026-10-01 and
2026-11-05, the share whose current status is "Currently Rated Helpful".
AI writers post far more notes than any human, so the top authors by volume
are almost all AI writers. Our own notes are matched by note id from a file
of our note ids, so our row is labelled with the bot that wrote each note.

Run from the worktree root:
  uv run --with pandas src/scripts_jim/2026_11_20_claude_code_x_review/ai_writer_helpful_share.py <our_notes.jsonl>
"""

import csv
import io
import json
import sys
import zipfile
from pathlib import Path

import pandas as pd

DUMP_DIR = Path("/home/jim/dev/data/cn-public-data/2026-11-13")
WINDOW_START_MILLIS = int(pd.Timestamp("2026-10-01", tz="UTC").timestamp() * 1000)
WINDOW_END_MILLIS = int(pd.Timestamp("2026-11-06", tz="UTC").timestamp() * 1000)
MISLEADING = "MISINFORMED_OR_POTENTIALLY_MISLEADING"
HELPFUL = "CURRENTLY_RATED_HELPFUL"
NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"
MIN_NOTES_PER_AUTHOR = 300
TOP_AUTHORS = 30

csv.field_size_limit(sys.maxsize)


def read_zipped_tsv(path: Path, columns: list[str]) -> pd.DataFrame:
    with zipfile.ZipFile(path) as archive:
        with archive.open(archive.namelist()[0]) as raw:
            return pd.read_csv(io.TextIOWrapper(raw, encoding="utf-8"), sep="\t", usecols=columns, dtype=str, quoting=csv.QUOTE_NONE, engine="c", on_bad_lines="skip")


def load_window_notes() -> pd.DataFrame:
    parts = [read_zipped_tsv(path, ["noteId", "noteAuthorParticipantId", "createdAtMillis", "classification"]) for path in sorted(DUMP_DIR.glob("notes-*.zip"))]
    notes = pd.concat(parts)
    created = pd.to_numeric(notes["createdAtMillis"], errors="coerce")
    in_window = (created >= WINDOW_START_MILLIS) & (created < WINDOW_END_MILLIS) & (notes["classification"] == MISLEADING)
    return notes[in_window]


def main():
    our_bots = {row["note_id"]: row["bot_name"] or "unknown" for row in map(json.loads, open(sys.argv[1]))}
    notes = load_window_notes()
    status = read_zipped_tsv(DUMP_DIR / "noteStatusHistory-00000.zip", ["noteId", "currentStatus"])
    notes = notes.merge(status, on="noteId", how="left")
    notes["helpful"] = notes["currentStatus"] == HELPFUL
    notes["not_helpful"] = notes["currentStatus"] == NOT_HELPFUL
    notes["ours"] = notes["noteId"].map(our_bots)

    by_author = notes.groupby("noteAuthorParticipantId").agg(notes=("noteId", "size"), helpful=("helpful", "mean"), not_helpful=("not_helpful", "mean"), ours=("ours", lambda s: s.notna().mean()))
    top = by_author[by_author["notes"] >= MIN_NOTES_PER_AUTHOR].sort_values("helpful", ascending=False).head(TOP_AUTHORS)
    print(f"Authors with at least {MIN_NOTES_PER_AUTHOR} misleading notes written 2026-10-01 to 2026-11-05, status as of the 2026-11-13 dump:")
    print(top.round(3).to_string())

    ours = notes[notes["ours"].notna()]
    print("\nOur notes found in the dump, by bot:")
    print(ours.groupby("ours").agg(notes=("noteId", "size"), helpful=("helpful", "mean"), not_helpful=("not_helpful", "mean")).round(3).to_string())
    print(f"\nAll authors in the window: {len(notes)} notes, {notes['helpful'].mean():.3f} helpful")


main()
