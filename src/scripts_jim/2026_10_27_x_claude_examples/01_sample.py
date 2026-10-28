# /// script
# dependencies = ["requests", "python-dotenv", "supabase", "langdetect"]
# ///
"""Step 1 of the X Claude examples (GOO-527, GOO-614): draw the candidate notes.

The pool is every note in the public Community Notes dump, by any author, that
  - was written in the last 6 months,
  - says the post is misleading (classification MISINFORMED_OR_POTENTIALLY_MISLEADING),
  - has a settled status, either rated helpful or rated not helpful,
  - is in English.

We draw more candidates than we need, because some tweets are deleted by now
and step 2 skips those. Each candidate also carries the note-not-needed notes
that other contributors wrote on the same tweet, with their status.

  uv run src/scripts_jim/2026_10_27_x_claude_examples/01_sample.py
"""

import csv
import importlib.util
import json
import random
import time
from collections import defaultdict
from pathlib import Path

from langdetect import DetectorFactory, LangDetectException, detect

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent.parent.parent

_spec = importlib.util.spec_from_file_location("fill_ratings", PROJECT_ROOT / "src" / "production" / "fill_ratings.py")
fr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fr)
fr.CN_DATA_DIR = PROJECT_ROOT / "src" / "scripts_jim" / "cn_data"

STATUS_FILE_TYPE = STATUS_PREFIX = "noteStatusHistory"
HELPFUL = "CURRENTLY_RATED_HELPFUL"
NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"
MISLEADING = "MISINFORMED_OR_POTENTIALLY_MISLEADING"
NOT_MISLEADING = "NOT_MISLEADING"

POOL_DAYS = 183
# Twice what we need, because step 2 drops the notes whose tweet X no longer serves.
CANDIDATES_PER_VERDICT = 100
SEED = 527
OUT_PATH = HERE / "candidates.jsonl"

DetectorFactory.seed = 0


def ensure_partitions(file_type: str, prefix: str) -> list[str]:
    files = fr.discover_partition_files(file_type, prefix)
    if not files:
        raise SystemExit(f"no {prefix} partitions found in the dump")
    for fname in files:
        if not (fr.CN_DATA_DIR / fname).exists() and not fr.try_download_partition(file_type, fname):
            raise SystemExit(f"failed to download {fname}")
    return files


def read_statuses(files: list[str]) -> dict[str, str]:
    status: dict[str, str] = {}
    for fname in files:
        with (fr.CN_DATA_DIR / fname).open() as f:
            for row in csv.DictReader(f, delimiter="\t"):
                status[row["noteId"]] = row.get("currentStatus") or ""
    return status


def read_notes(files: list[str]) -> list[dict]:
    notes = []
    for fname in files:
        with (fr.CN_DATA_DIR / fname).open() as f:
            for row in csv.DictReader(f, delimiter="\t"):
                notes.append({
                    "note_id": row["noteId"],
                    "tweet_id": row["tweetId"],
                    "created_at_ms": int(row.get("createdAtMillis") or 0),
                    "classification": row.get("classification") or "",
                    "text": row.get("summary") or "",
                })
        print(f"[notes] {fname}: {len(notes):,} notes so far")
    return notes


def is_english(text: str) -> bool:
    try:
        return detect(text) == "en"
    except LangDetectException:
        return False


def draw(pool: list[dict], count: int, rng: random.Random) -> list[dict]:
    """Draws English notes at random until it has `count`. Detecting the
    language of the whole pool would take far longer than of a sample."""
    order = pool[:]
    rng.shuffle(order)
    drawn = []
    for note in order:
        if is_english(note["text"]):
            drawn.append(note)
        if len(drawn) == count:
            break
    return drawn


def main() -> None:
    fr.CN_DATA_DIR.mkdir(parents=True, exist_ok=True)
    status = read_statuses(ensure_partitions(STATUS_FILE_TYPE, STATUS_PREFIX))
    notes = read_notes(ensure_partitions(fr.NOTE_FILE_TYPE, fr.NOTE_PREFIX))
    for note in notes:
        note["status"] = status.get(note["note_id"], "")

    cutoff_ms = (time.time() - POOL_DAYS * 86400) * 1000
    recent_misleading = [n for n in notes if n["created_at_ms"] >= cutoff_ms and n["classification"] == MISLEADING]
    pools = {verdict: [n for n in recent_misleading if n["status"] == verdict] for verdict in (HELPFUL, NOT_HELPFUL)}
    print(f"[pool] last {POOL_DAYS} days: {len(pools[HELPFUL]):,} helpful, {len(pools[NOT_HELPFUL]):,} not helpful")

    not_needed_by_tweet: dict[str, list[dict]] = defaultdict(list)
    for n in notes:
        if n["classification"] == NOT_MISLEADING:
            not_needed_by_tweet[n["tweet_id"]].append({"text": n["text"], "status": n["status"], "created_at_ms": n["created_at_ms"]})

    rng = random.Random(SEED)
    with OUT_PATH.open("w") as f:
        for verdict, pool in pools.items():
            for note in draw(pool, CANDIDATES_PER_VERDICT, rng):
                note["not_needed_notes"] = not_needed_by_tweet.get(note["tweet_id"], []) if verdict == NOT_HELPFUL else []
                f.write(json.dumps(note) + "\n")
    print(f"[out] wrote {2 * CANDIDATES_PER_VERDICT} candidates to {OUT_PATH}")


if __name__ == "__main__":
    main()
